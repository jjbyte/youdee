'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { OcrSettings } from '@/lib/types';
import { cx, fileSize } from '@/lib/format';
/** 两个上限（OCR 7.5MB / 补原件 20MB）住在一起：分开写早晚会被"统一一下"改坏 */
import { mb, pdfTooBigForOcr } from '@/lib/invoice-file-limits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { IconError, IconLoading, IconPlus, IconRefresh, IconSuccess } from '@/components/icons';

/**
 * 批量上传发票（多选 PDF / JPG / PNG，**并发 3**）。
 *
 * 为什么是 3 不是 5：腾讯云 RecognizeGeneralInvoice 的频率上限是 5 次/秒，
 * 并发 5 会把余量吃干净，一张超时重试就撞限流；并发 3 留了两次重试的余量。
 *
 * 三条与后端一致的行为（不自己在界面上另编一套）：
 *   - 票号已存在 → 服务端不新建、不重复计费，界面显示「已存在，跳过」；
 *   - 识别失败/超时 → 服务端丢弃临时文件、不落库（不留半成品行），界面标红并可单条重传；
 *   - 未配置识别 → 上传按钮直接置灰并指路设置页，不让人传完 20 张才发现没配。
 *
 * 进度逐条显示，不做"总进度条"：批量上传失败是常态（模糊票/超限 PDF），
 * 一条总进度条只会告诉你"到 80% 了"，不会告诉你哪 3 张需要重传。
 */

const CONCURRENCY = 3;

type RowStatus = 'queued' | 'running' | 'ok' | 'dup' | 'fail';

interface UploadRow {
  key: string;
  name: string;
  size: number;
  status: RowStatus;
  message: string;
  /** 逐条补充说明：金额标黄的提醒、同一文件里其它票的去向 */
  notes: string[];
}

export function InvoiceUploadButton({
  onUploaded,
  onReadyChange,
}: {
  onUploaded: () => void;
  /**
   * 把"能不能传"报给上层——空态要据此决定先推荐「批量上传」还是「手工录入」。
   * 三态而非布尔：还在读 / 读失败时**不能**当成"没配"，否则网络抖一下就会
   * 让用户去填早就填好的密钥。
   */
  onReadyChange?: (state: 'unknown' | 'ready' | 'blocked') => void;
}) {
  const [ocr, setOcr] = useState<OcrSettings | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** File 对象不进 state：它不可序列化，且一次几百 MB，塞进 state 会被反复 diff */
  const filesRef = useRef<Map<string, File>>(new Map());

  useEffect(() => {
    let alive = true;
    api
      .ocrSettings()
      .then((s) => {
        if (alive) setOcr(s);
      })
      .catch(() => {
        // 读不到配置（接口未就绪 / 权限）不拦人：真没配时服务端会 409 并给同一句话，
        // 比在这里猜"没配"然后把人挡在门外要稳。
        if (alive) setOcr(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 未配置识别 → 置灰。ocr 为 null（读失败/还没读）时不置灰，交给服务端判 */
  const ready = ocr === null || (ocr.enabled && ocr.secretKeySet);

  useEffect(() => {
    onReadyChange?.(ocr === null ? 'unknown' : ocr.enabled && ocr.secretKeySet ? 'ready' : 'blocked');
  }, [ocr, onReadyChange]);

  const counts = useMemo(() => {
    const c = { ok: 0, dup: 0, fail: 0, running: 0, queued: 0 };
    for (const r of rows) {
      if (r.status === 'ok') c.ok += 1;
      else if (r.status === 'dup') c.dup += 1;
      else if (r.status === 'fail') c.fail += 1;
      else if (r.status === 'running') c.running += 1;
      else c.queued += 1;
    }
    return c;
  }, [rows]);

  function patchRow(key: string, patch: Partial<UploadRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function uploadOne(key: string, file: File) {
    if (pdfTooBigForOcr(file)) {
      patchRow(key, {
        status: 'fail',
        message: `这个 PDF 有 ${mb(file.size)}MB，识别上限约 7.5MB`,
        notes: ['先压缩或拆页再传。也可以先用「手工录入」把票号记下来，原件等压好再传。'],
      });
      return;
    }
    patchRow(key, { status: 'running', message: '识别中…', notes: [] });
    try {
      const r = await api.uploadInvoice(file);
      if (r.duplicated) {
        patchRow(key, {
          status: 'dup',
          message: r.attachedFile ? '票号已存在，原件已补挂到那张票上' : '票号已存在，这张没新建',
          notes: ['判定用的是「发票代码 + 号码」，所以同号不同代码的两张真票不会被吞。'],
        });
        return;
      }
      const notes = [...(r.warnings ?? [])];
      for (const e of r.extraItems ?? []) {
        notes.push(
          e.saved
            ? `第 ${e.page} 页的 ${e.invoiceNo} 也一起入账了`
            : `第 ${e.page} 页的 ${e.invoiceNo} 没入库${e.reason ? `：${e.reason}` : ''}`,
        );
      }
      patchRow(key, { status: 'ok', message: '已识别入库', notes });
    } catch (e) {
      patchRow(key, { status: 'fail', message: errorMessage(e), notes: [] });
    }
  }

  /** 固定并发跑完一批：cursor 自增，谁先空谁退出，天然不会超过 CONCURRENCY 个在飞 */
  async function runBatch(keys: string[]) {
    if (keys.length === 0) return;
    setRunning(true);
    let cursor = 0;
    const worker = async () => {
      while (cursor < keys.length) {
        const key = keys[cursor++];
        if (!key) return;
        const file = filesRef.current.get(key);
        if (file) await uploadOne(key, file);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
    setRunning(false);
    onUploaded();
  }

  function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    filesRef.current = new Map();
    const next: UploadRow[] = files.map((f, i) => {
      const key = `${Date.now()}-${i}`;
      filesRef.current.set(key, f);
      return { key, name: f.name, size: f.size, status: 'queued', message: '排队中', notes: [] };
    });
    setRows(next);
    setOpen(true);
    void runBatch(next.map((r) => r.key));
  }

  function retry(row: UploadRow) {
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'queued', message: '排队中', notes: [] } : r)));
    void runBatch([row.key]);
  }

  return (
    <>
      {/* 换行是必要的：不换行时「识别还没配置」那句提示会被压成每行一个字 */}
      <div className="flex items-center gap-[var(--space-3)] flex-wrap">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          variant="primary"
          icon={<IconPlus size={16} />}
          disabled={!ready || running}
          onClick={() => inputRef.current?.click()}
          title={ready ? '多选 PDF / JPG / PNG，一次最多按并发 3 张识别' : '发票识别还没配置'}
        >
          {running ? `识别中 ${counts.ok + counts.dup + counts.fail}/${rows.length}` : '批量上传发票'}
        </Button>
        {!ready ? (
          <span className="t-2xs t-3 max-w-[220px]">
            识别还没配置：设置 → 发票识别 里填腾讯云密钥后就能传。
          </span>
        ) : null}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="批量上传发票"
        width="min(760px, 94vw)"
        footer={
          <>
            <span className="t-xs t-3 mr-auto">
              成功 <span className="num">{counts.ok}</span> · 已存在{' '}
              <span className="num">{counts.dup}</span> · 失败 <span className="num">{counts.fail}</span>
              {counts.queued + counts.running > 0
                ? ` · 还剩 ${counts.queued + counts.running} 张`
                : ''}
            </span>
            <Button variant={running ? 'ghost' : 'primary'} onClick={() => setOpen(false)}>
              {running ? '后台继续（可关掉）' : '完成'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-3)]">
          <p className="t-xs t-3">
            一次并发 3 张。票号已存在的会自动跳过、不重复计费；识别失败的可以单条重传。
            关掉这个窗口不影响已经在传的文件，列表会在全部结束后自动刷新。
          </p>

          <ul className="flex flex-col gap-[var(--space-2)]">
            {rows.map((r) => (
              <li
                key={r.key}
                className="flex items-start gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)]"
              >
                <span className="mt-[2px]">
                  {r.status === 'running' ? (
                    <IconLoading size={16} className="animate-spin t-3" />
                  ) : r.status === 'ok' ? (
                    <IconSuccess size={16} className="t-success" />
                  ) : r.status === 'fail' ? (
                    <IconError size={16} className="t-danger" />
                  ) : (
                    <span className="t-3">·</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="t-sm truncate" title={r.name}>
                    {r.name}
                  </div>
                  <div className="t-2xs t-3 flex items-center gap-[var(--space-2)] flex-wrap">
                    <span className={cx(r.status === 'fail' && 't-danger')}>{r.message}</span>
                    {fileSize(r.size) ? <span>· {fileSize(r.size)}</span> : null}
                    {r.status === 'dup' ? <Badge tone="neutral">已存在</Badge> : null}
                  </div>
                  {r.notes.length > 0 ? (
                    <ul className="mt-[var(--space-1)]">
                      {r.notes.map((n, i) => (
                        <li key={i} className="t-2xs t-3">
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {r.status === 'fail' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconRefresh size={14} />}
                    disabled={running}
                    onClick={() => retry(r)}
                  >
                    重传
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {counts.fail > 0 && !running ? (
            <Note tone="warn">
              失败的几张没入库，所以不会留下"有票号没金额"的空行。
              模糊/盖住关键字段的票识别不出来是 OCR 的物理边界，换一张清晰的、或用「手工录入」先把票号记下来。
            </Note>
          ) : null}
          <Note tone="neutral">
            只收 PDF / JPG / PNG。OFD 请先在电子税务局另存为 PDF 再传——识别接口不收 OFD。
          </Note>
        </div>
      </Modal>
    </>
  );
}
