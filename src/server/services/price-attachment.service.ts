/**
 * 价格附件：报价截图 / 供应商 PDF。
 *
 * 为什么必须留证据：价格库里最贵的错误是"这个价到底是谁说的、什么时候说的"。
 * 一条没有来源的价格，吵起来时等于没有。
 */
import { one, q } from '../db';
import { AppError } from '../http';
import { saveUpload } from './upload.service';

export async function addPriceAttachment(priceId: string, file: File, note: string | null) {
  const price = await one<{ id: string }>('SELECT id FROM prices WHERE id = $1', [priceId]);
  if (!price) throw new AppError(40401, '这条价格不存在。', 404);
  const saved = await saveUpload(file, `prices/${priceId}`);
  const rows = await q<{
    id: string;
    kind: string;
    storage_key: string;
    url: string;
    original_name: string | null;
    mime: string | null;
    size_bytes: number | null;
    note: string | null;
    created_at: Date;
  }>(
    `INSERT INTO price_attachments (price_id, kind, storage_key, url, original_name, mime, size_bytes, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, kind, storage_key, url, original_name, mime, size_bytes, note, created_at`,
    [priceId, saved.kind, saved.storageKey, saved.url, saved.originalName, saved.mime, saved.sizeBytes, note],
  );
  const r = rows[0]!;
  return {
    id: r.id,
    kind: r.kind,
    storage_key: r.storage_key,
    thumb_key: null,
    url: r.url,
    thumb_url: null,
    original_name: r.original_name ?? '',
    mime: r.mime ?? '',
    size_bytes: r.size_bytes ?? 0,
    width: null,
    height: null,
    sort_order: 0,
    note: r.note,
    created_at: r.created_at.toISOString(),
  };
}

export async function deletePriceAttachment(priceId: string, attachmentId: string) {
  const rows = await q('DELETE FROM price_attachments WHERE id = $1 AND price_id = $2 RETURNING id', [
    attachmentId,
    priceId,
  ]);
  if (rows.length === 0) throw new AppError(40401, '这个附件不存在。', 404);
  // 物理文件由周清理任务回收：先删库行，避免"文件没了但库里还挂着"
}
