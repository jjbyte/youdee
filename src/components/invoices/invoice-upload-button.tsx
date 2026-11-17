'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { InvoiceUploadRedHint, OcrSettings } from '@/lib/types';
import { cx, fileSize, formatDecimalString } from '@/lib/format';
/** 两个上限（OCR 7.5MB / 补原件 20MB）住在一起：分开写早晚会被"统一一下"改坏 */
import { mb, pdfTooBigForOcr } from '@/lib/invoice-file-limits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { IconError, IconLoading, IconPlus, IconRefresh, IconSuccess } from '@/components/icons';

/**
 * 批量上传发票（多选 PDF / OFD / JPG / PNG，**并发 3**）。
 *
 * 为什么是 3 不是 5：腾讯云 RecognizeGeneralInvoice 的频率上限是 5 次/秒，
 * 并发 5 会把余量吃干净，一张超时重试就撞限流；并发 3 留了两次重试的余量。
 *
 * 三条与后端一致的行为（不自己在界面上另编一套）：
 *   - 票号已存在 → 服务端不新建、不重复计费，界面显示「已存在，跳过」；
 *   - 识别失败/超时 → 服务端丢弃临时文件、不落库（不留半成品行），界面标红并可单条重传；
 *   - 未配置识别 → 上传按钮直接置灰并指路设置页，不让人传完 20 张才发现没配；
 *   - 认出红冲票而同号票已在库 → **不替人改状态**，弹一句问清楚（见下方 RedHintModal）。
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
  /** 这一行识别出红冲票、且同号票已在库 → 记下那张票的 id，等人在弹窗里确认 */
  awaitingRed?: string;
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
  /**
   * 待确认的红冲票（跨多个文件累积）。
   *
   * 放 state 而不是立刻弹 action sheet：一次批量里可能有 2–3 张红票，
   * 一张一个弹窗会变成"关不完的对话框"，所以排成队列逐条问。
   */
  const [redHints, setRedHints] = useState<InvoiceUploadRedHint[]>([]);
  const [redBusy, setRedBusy] = useState(false);
  const [redError, setRedError] = useState<string | null>(null);
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

  /** 红冲弹窗什么时候真的挡住画面：整批跑完了、且还有待确认的（见弹窗处注释） */
  const redOpen = redHints.length > 0 && !running;

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
      const hints = r.redHints ?? [];
      if (hints.length > 0) {
        // 同一张票被两个文件各自撞到时只问一次：按 invoiceId 去重
        setRedHints((prev) => {
          const seen = new Set(prev.map((h) => h.invoiceId));
          return [...prev, ...hints.filter((h) => !seen.has(h.invoiceId))];
        });
      }
      if (r.duplicated) {
        patchRow(key, {
          status: 'dup',
          message: hints.length > 0
            ? '识别为红冲票，系统里已有这张——等你确认要不要标冲红'
            : r.attachedFile ? '票号已存在，原件已补挂到那张票上' : '票号已存在，这张没新建',
          notes: hints.length > 0
            ? ['没确认之前那张票不会变，合计也没动。']
            : ['判定用的是「发票代码 + 号码」，所以同号不同代码的两张真票不会被吞。'],
          awaitingRed: hints.length > 0 ? hints[0]!.invoiceId : undefined,
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

  /* ── 红冲确认 ────────────────────────────────────────────── */

  /** 保持原样：只把那一行的标注改掉，库里的票一个字段都不动 */
  function skipRed() {
    const h = redHints[0];
    if (!h) return;
    setRedHints((q) => q.slice(1));
    setRedError(null);
    setRows((prev) =>
      prev.map((r) => (r.awaitingRed === h.invoiceId
        ? { ...r, awaitingRed: undefined, message: '保持原样：那张票没改', notes: ['之后也能在发票抽屉里手动改成冲红。'] }
        : r)),
    );
  }

  /**
   * 标记为冲红：调的是抽屉里同一个接口（PATCH /invoices/:id/status）。
   * 不在这里自己拼一次 UPDATE —— 那个接口负责「状态与三项金额的符号同步翻转」，
   * 另写一份迟早会漏掉符号，变成"状态是冲红、金额还是正数"。
   */
  async function confirmRed() {
    const h = redHints[0];
    if (!h) return;
    setRedBusy(true);
    setRedError(null);
    try {
      await api.setInvoiceStatus(h.invoiceId, 'red');
      setRedHints((q) => q.slice(1));
      setRows((prev) =>
        prev.map((r) => (r.awaitingRed === h.invoiceId
          ? { ...r, awaitingRed: undefined, message: '已标记为冲红，三项金额已转成负数', notes: [] }
          : r)),
      );
      onUploaded();
    } catch (e) {
      // 留在弹窗里显示原文：这时候「改没改成功」是唯一重要的事，不能吞
      setRedError(errorMessage(e));
    } finally {
      setRedBusy(false);
    }
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
          accept=".pdf,.ofd,.jpg,.jpeg,.png"
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
          title={ready ? '多选 PDF / OFD / JPG / PNG，一次最多按并发 3 张识别' : '发票识别还没配置'}
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
        open={open && !redOpen}
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
            收 PDF / OFD / JPG / PNG。OFD 只识别**第一页**（数电票通常只有一页）；
            多页 OFD 请另存成 PDF，否则后面的页不会入账。
          </Note>
        </div>
      </Modal>

      {/*
        红冲确认。**单独一个 Modal，同时把批量弹窗先收起来**（`open && redHints.length === 0`）：
        两层 scrim 会压在同一层级，谁在上面取决于 DOM 顺序，那种"有时能点有时点不动"的毛病最难查。
        收起批量弹窗还顺带解决了一件事——确认完之后结果列表会自己回来。

        等整批跑完再问（`!running`）：识别途中弹出来会盖住进度，用户正盯着"还剩几张"。
      */}
      <Modal
        open={redOpen}
        onClose={skipRed}
        title="识别到红冲票，要标记吗？"
        width="min(560px, 94vw)"
        footer={
          <>
            <Button variant="ghost" disabled={redBusy} onClick={skipRed}>
              保持原样
            </Button>
            <Button variant="danger" loading={redBusy} onClick={() => void confirmRed()}>
              标记为冲红
            </Button>
          </>
        }
      >
        {redHints[0] ? (
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="t-sm">
              系统里已经有一张号码相同的票：
              <span className="num">{redHints[0].invoiceNo}</span>
              {redHints[0].totalAmount
                ? <>，价税合计 <span className="num">{formatDecimalString(redHints[0].totalAmount, { symbol: true })}</span></>
                : null}
              ，当前是「正常」。
            </p>
            <p className="t-sm">
              这次上传的文件里，这张被判定为红冲票（{redHints[0].basis}）。
              把它标记为「冲红」后，三项金额会一起变成负数，合计随之变小。
            </p>
            <Note tone="warn">
              红票只能靠启发式判定（金额负号、票面上的「红字」字样），识别接口不返回红票标记。
              判错会让合计虚高，所以这一步留给你确认：选「保持原样」什么都不改，
              之后也能在发票抽屉里手动改。
            </Note>
            {redHints.length > 1 ? (
              <p className="t-2xs t-3">还有 {redHints.length - 1} 张待确认，处理完这张会接着问。</p>
            ) : null}
            {redError ? (
              <div className="field-error" role="alert">
                {redError}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
