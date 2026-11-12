'use client';
/**
 * 合同附件在线预览。
 *
 * 三种画法，取决于**浏览器原生能做什么**，而不是取决于我们希望：
 *   PDF    → iframe，交给浏览器自带的阅读器（能翻页、能搜索、能缩放，全都免费）
 *   图片   → <img>，原样显示
 *   docx   → docx-preview 解析后重排成 HTML（浏览器自己不认识 Word）
 *   xlsx   → 服务端 exceljs 解析成二维字符串，这里画 <table>
 *   doc/xls → 没有解析器能读二进制老格式，只能提示下载
 *
 * 两个刻意的取舍：
 *
 * 1. **docx 走同源 content 接口取字节，不走 raw**。raw 对云存储文件是 302 到
 *    预签名地址，`fetch` 跟过去就变成跨域请求，而桶的 CORS 默认是空的 ——
 *    现象是"点预览一直转圈"、服务端日志一行都没有，属于没有服务器现场就查不出的问题。
 * 2. **解析库动态 import**。docx-preview 只在真的点开一份 Word 时才加载，
 *    不进合同列表的首屏 bundle；不这么写，一个偶尔用的功能会让每次进页面都多背几十 KB。
 */
import { useEffect, useRef, useState } from 'react';
import { api, isApiError } from '@/lib/api';
import type { ContractFile, SheetPreview } from '@/lib/types';
import { canPreview, previewBlockedHint, previewKind } from '@/lib/file-preview';
import { cx, fileSize } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/overlay';
import { InlineLoading, Note } from '@/components/ui/states';
import { IconDownload, IconFile } from '@/components/icons';

/** 同源字节地址。为什么不用 file.url，见文件头第 1 条 */
const contentUrl = (contractId: string, fileId: string) =>
  `/api/v1/contracts/${contractId}/files/${fileId}/content`;

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: unknown };
    if (typeof j.message === 'string' && j.message) return j.message;
  } catch {
    // 不是 JSON（网关错误页、空响应），走下面的兜底文案
  }
  return `读取附件失败（HTTP ${res.status}）`;
}

/** docx-preview 的渲染参数。抽成常量，改动时只有一处 */
const DOCX_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  // 忽略文档里写的页宽：A4 正文在弹层里会撑出横向滚动条，而这里要的是"能读"
  ignoreWidth: true,
  ignoreHeight: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
} as const;

function DocxView({ url }: { url: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // alive 挡住"已经关掉弹层、异步还在跑"的 setState：不挡的话关掉再开另一份
    // Word 时，上一份的渲染结果会盖到这一份上
    let alive = true;
    setLoading(true);
    setErr(null);

    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(await readError(res));
        const blob = await res.blob();
        if (!alive || !boxRef.current) return;
        const { renderAsync } = await import('docx-preview');
        if (!alive || !boxRef.current) return;
        boxRef.current.replaceChildren();
        await renderAsync(blob, boxRef.current, undefined, DOCX_OPTIONS);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '这份 Word 解析失败，请下载后打开。');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [url]);

  if (err) {
    return (
      <Note tone="danger">
        {err}
        <div className="t-xs t-3 mt-[var(--space-1)]">排版可能过新或文件已损坏，下载后用 Word 打开最稳。</div>
      </Note>
    );
  }
  return (
    <div className="relative">
      {loading ? (
        <div className="py-[var(--space-8)] flex justify-center">
          <InlineLoading label="正在解析文档…" />
        </div>
      ) : null}
      <div ref={boxRef} className="docx-host" />
    </div>
  );
}

function SheetView({ contractId, fileId }: { contractId: string; fileId: string }) {
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSheets(null);
    setErr(null);
    setActive(0);
    api
      .contractFileSheet(contractId, fileId)
      .then((r) => {
        if (alive) setSheets(r.sheets);
      })
      .catch((e: unknown) => {
        if (alive) setErr(isApiError(e) ? e.message : '这份 Excel 读取失败，请下载后打开。');
      });
    return () => {
      alive = false;
    };
  }, [contractId, fileId]);

  if (err) {
    return (
      <Note tone="danger">
        {err}
        <div className="t-xs t-3 mt-[var(--space-1)]">只支持 .xlsx；老版 .xls 需要另存为 .xlsx 再上传。</div>
      </Note>
    );
  }
  if (!sheets) {
    return (
      <div className="py-[var(--space-8)] flex justify-center">
        <InlineLoading label="正在解析表格…" />
      </div>
    );
  }

  const sheet = sheets[active] ?? sheets[0]!;
  const [head, ...body] = sheet.rows;

  return (
    <div className="flex flex-col gap-[var(--space-3)] h-full min-h-0">
      {sheets.length > 1 ? (
        <div className="flex items-center gap-[var(--space-2)] flex-wrap">
          {sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              className={cx('chip', i === active && 'chip--on')}
              aria-pressed={i === active}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="t-xs t-3">工作表：{sheet.name}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto border border-[var(--border)] rounded-[var(--radius-md)]">
        <table className="w-full border-collapse t-xs">
          {head ? (
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className="bg-[var(--surface-2)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] t-3 w-[48px]">#</th>
                {head.map((v, i) => (
                  <th
                    key={i}
                    className="bg-[var(--surface-2)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-left fw-semi whitespace-nowrap"
                  >
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                <td className="border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] t-3 text-right">
                  {r + 2}
                </td>
                {row.map((v, c) => (
                  <td
                    key={c}
                    className="border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] align-top whitespace-pre-wrap break-words"
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheet.truncated ? (
        <div className="t-2xs t-3">
          只显示前 {sheet.rows.length} 行 / {sheet.totalCols} 列（原表 {sheet.totalRows} 行）。完整内容请下载。
        </div>
      ) : null}
    </div>
  );
}

export function ContractFilePreview({
  open,
  contractId,
  file,
  onClose,
}: {
  open: boolean;
  contractId: string | null;
  file: ContractFile | null;
  onClose: () => void;
}) {
  if (!open || !file || !contractId) return null;
  const kind = previewKind(file.ext);

  return (
    <Modal
      open
      onClose={onClose}
      title={file.originalName || '附件预览'}
      icon={<IconFile size={18} />}
      width="min(1080px, 94vw)"
    >
      <div className="flex items-center gap-[var(--space-3)] mb-[var(--space-3)]">
        <Badge tone="neutral">{(file.ext || '文件').toUpperCase()}</Badge>
        {fileSize(file.sizeBytes) ? <span className="t-xs t-3">{fileSize(file.sizeBytes)}</span> : null}
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="btn btn--link ml-auto"
          aria-label={`下载 ${file.originalName || '附件'}`}
        >
          <IconDownload size={14} /> 下载原件
        </a>
      </div>

      {/* 统一高度：docx 长文档和 pdf 都在这里面滚，不让整个弹层跟着长高 */}
      <div className="h-[70vh] min-h-[280px] overflow-auto bg-[var(--surface)] rounded-[var(--radius-md)]">
        {kind === 'pdf' ? (
          <iframe src={file.url} title={file.originalName || 'PDF 预览'} className="w-full h-full border-0" />
        ) : kind === 'image' ? (
          <div className="p-[var(--space-3)] flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.url} alt={file.originalName || '附件图片'} className="max-w-full h-auto" />
          </div>
        ) : kind === 'docx' ? (
          <DocxView url={contentUrl(contractId, file.id)} />
        ) : kind === 'sheet' ? (
          <div className="h-full p-[var(--space-3)]">
            <SheetView contractId={contractId} fileId={file.id} />
          </div>
        ) : (
          <div className="p-[var(--space-4)]">
            <Note tone="info">{previewBlockedHint(file.ext)}</Note>
          </div>
        )}
      </div>

      {canPreview(file.ext) && (kind === 'docx' || kind === 'sheet') ? (
        <p className="t-2xs t-3 mt-[var(--space-2)]">
          这是内容预览：合并单元格、颜色、图片位置等排版不会完全还原。要看原样请下载。
        </p>
      ) : null}
    </Modal>
  );
}
