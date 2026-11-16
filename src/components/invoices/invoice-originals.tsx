'use client';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { InvoiceDetail, InvoiceFile } from '@/lib/types';
import { fileSize, formatTimeRel } from '@/lib/format';
import { previewKind } from '@/lib/file-preview';
import { checkInvoiceAttach } from '@/lib/invoice-file-limits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/states';
import { IconDownload, IconFile, IconPaperclip } from '@/components/icons';
import { InvoiceFilePreview, invoiceFileExt } from './invoice-file-preview';

/**
 * 发票抽屉里的「原件」块。
 *
 * 没有原件是很常见的一种正常状态（手工录入的票、或者上传失败后先记了票号），
 * 所以空态不写"暂无数据"，而是说清"补了会怎样"：这里补传**只挂文件、不跑识别**，
 * 字段一个都不会被改。
 */
export function InvoiceOriginals({
  invoiceId,
  files,
  hasSaved,
  disabled = false,
  onAttached,
  onPreviewOpenChange,
}: {
  /** null = 新建态，还没落库 */
  invoiceId: string | null;
  files: InvoiceFile[];
  /** 是否已落库（新建时 false） */
  hasSaved: boolean;
  /** 票已软删：服务端补原件会 404，按钮直接不给 */
  disabled?: boolean;
  /** 补原件成功。抽屉只回填 detail，**不回填表单**——用户可能正改到一半 */
  onAttached?: (next: InvoiceDetail, fileName: string) => void;
  /**
   * 预览层开了没有，报给抽屉。
   *
   * 预览是盖在抽屉上的一层 Modal，它和抽屉都在 document 上监听 Esc ——
   * 不告诉抽屉"上面有人"，按一次 Esc 会把预览和抽屉一起关掉，
   * 用户以为只关了预览，抬头发现填了一半的字段连抽屉一起没了。
   */
  onPreviewOpenChange?: (open: boolean) => void;
}) {
  const [preview, setPreview] = useState<InvoiceFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onPreviewOpenChange?.(preview !== null);
  }, [preview, onPreviewOpenChange]);

  async function attach(f: File) {
    if (!invoiceId) return;
    const check = checkInvoiceAttach(f.name, f.size);
    if (!check.ok) {
      setAttachError(check.reason);
      return;
    }
    setBusy(true);
    setRatio(0);
    setAttachError(null);
    try {
      const next = await api.uploadInvoiceFile(invoiceId, f, { onProgress: setRatio });
      onAttached?.(next, f.name);
    } catch (e) {
      setAttachError(errorMessage(e));
    } finally {
      setBusy(false);
      // 允许同一个文件再选一次（上次失败时用户的第一反应就是重选这份）
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const canAttach = Boolean(invoiceId) && !disabled;

  return (
    <div className="pt-[var(--space-4)] border-t border-[var(--border)]">
      <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)] flex-wrap">
        <IconFile size={16} />
        <span className="fw-semi t-sm">原件</span>
        {files.length > 0 ? <Badge tone="neutral">{files.length} 份</Badge> : null}
        <span style={{ flex: 1 }} />
        {canAttach ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="sr-only"
              aria-label="选择要补的发票原件"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void attach(f);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<IconPaperclip size={14} />}
              loading={busy}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? `上传中 ${Math.round(ratio * 100)}%` : '补原件'}
            </Button>
          </>
        ) : null}
      </div>

      {attachError ? (
        <div className="field-error mb-[var(--space-2)]" role="alert">
          {attachError}
        </div>
      ) : null}

      {!hasSaved || !invoiceId ? (
        <Note tone="neutral">先把票存下来，再补原件——文件要挂到这张票上。</Note>
      ) : files.length === 0 ? (
        <Note tone="neutral">
          还没有原件。点「补原件」传扫描件：只存文件、不再跑一次识别，所以字段不会被改，
          之前认错的地方也不会被冲掉。之后在列表页「批量上传发票」里传同一张票，
          会按「代码 + 号码」合并到这张票上，不会新建第二行。
        </Note>
      ) : (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {files.map((f) => {
            const ext = invoiceFileExt(f);
            const kind = previewKind(ext);
            const viewable = kind === 'pdf' || kind === 'image';
            return (
              <li
                key={f.id}
                className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)]"
              >
                <IconFile size={16} />
                <div className="min-w-0 flex-1">
                  <div className="truncate t-sm">{f.originalName || f.id}</div>
                  <div className="t-2xs t-3">
                    {(ext || 'file').toUpperCase()}
                    {fileSize(f.sizeBytes) ? ` · ${fileSize(f.sizeBytes)}` : ''} ·{' '}
                    {formatTimeRel(f.createdAt)}
                  </div>
                </div>
                {viewable ? (
                  <button
                    type="button"
                    className="btn btn--link"
                    aria-label={`预览 ${f.originalName || '原件'}`}
                    onClick={() => setPreview(f)}
                  >
                    预览
                  </button>
                ) : (
                  <span className="t-2xs t-3">只能下载</span>
                )}
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn--link"
                  aria-label={`下载 ${f.originalName || '原件'}`}
                >
                  <IconDownload size={14} /> 下载
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {preview && invoiceId ? (
        <InvoiceFilePreview invoiceId={invoiceId} file={preview} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}
