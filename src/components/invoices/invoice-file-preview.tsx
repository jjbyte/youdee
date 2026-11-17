'use client';
import type { InvoiceFile } from '@/lib/types';
import { fileSize } from '@/lib/format';
import { previewKind, previewBlockedHint } from '@/lib/file-preview';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { PdfPreview } from '@/components/ui/pdf-preview';
import { IconDownload, IconFile } from '@/components/icons';

/** 原件扩展名：先看服务端按字节判定的 ext，再看 mime，最后退回文件名 */
export function invoiceFileExt(f: { originalName: string; mime: string; ext?: string }): string {
  if (f.ext) return f.ext.toLowerCase().replace(/^\./, '');
  const byMime =
    f.mime === 'application/pdf'
      ? 'pdf'
      : f.mime === 'image/png'
        ? 'png'
        : f.mime === 'image/jpeg'
          ? 'jpg'
          : '';
  if (byMime) return byMime;
  const m = /\.([a-z0-9]+)$/i.exec(f.originalName || '');
  return (m?.[1] ?? '').toLowerCase();
}

/**
 * 发票原件预览。
 *
 * 只处理 PDF 与图片两种——发票原件只有这两类，docx/xlsx 那套解析器在这里是负担不是能力。
 * OFD 浏览器自身不认识，只能下载（列表里那一行会明说"只能下载"，不给假按钮）。
 *
 * 地址走同源 `content` 路由，**不用 `file.url`**：云存储的 url / `/raw` 会 302 到预签名
 * 地址，能不能内联取决于中间层有没有保留 disposition 参数；一旦丢掉，桶里的元数据
 * （attachment）生效，点「预览」就变成下载一个文件。合同附件那条路已经踩过这个坑，
 * 这里用同一套做法（服务端自己写 mime 与 inline）。
 */
export function InvoiceFilePreview({
  invoiceId,
  file,
  onClose,
}: {
  invoiceId: string;
  file: InvoiceFile;
  onClose: () => void;
}) {
  const ext = invoiceFileExt(file);
  const kind = previewKind(ext);
  const src = `/api/v1/invoices/${invoiceId}/files/${file.id}/content`;

  return (
    <Modal
      open
      onClose={onClose}
      title={file.originalName || '原件预览'}
      icon={<IconFile size={18} />}
      width="min(1080px, 94vw)"
    >
      <div className="flex items-center gap-[var(--space-3)] mb-[var(--space-3)]">
        <Badge tone="neutral">{(ext || '文件').toUpperCase()}</Badge>
        {fileSize(file.sizeBytes) ? <span className="t-xs t-3">{fileSize(file.sizeBytes)}</span> : null}
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="btn btn--link ml-auto"
          aria-label={`下载 ${file.originalName || '原件'}`}
        >
          <IconDownload size={14} /> 下载原件
        </a>
      </div>

      <div className="h-[70vh] min-h-[280px] overflow-auto bg-[var(--surface)] rounded-[var(--radius-md)]">
        {kind === 'pdf' ? (
          <PdfPreview url={src} fileName={file.originalName} />
        ) : kind === 'image' ? (
          <div className="p-[var(--space-3)] flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={file.originalName || '发票原件'} className="max-w-full h-auto" />
          </div>
        ) : (
          <div className="p-[var(--space-4)]">
            <Note tone="info">{previewBlockedHint(ext)}</Note>
          </div>
        )}
      </div>

      <p className="t-2xs t-3 mt-[var(--space-2)]">
        看的是原件本身；金额与字段以抽屉里的值为准——那是入库时的快照，改字段不会动原件。
      </p>
    </Modal>
  );
}
