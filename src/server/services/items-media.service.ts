/**
 * 主体的图片与外链（附属资源）。
 *
 * 与主体本身分开：这两类东西的写权限、校验（URL 形状、文件类型）和失败语义都不同，
 * 放在同一个文件里会让"改一个主体的名字"和"删一张图"共用一次 import 边界。
 */
import { one, q } from '../db';
import { AppError } from '../http';

export async function addImage(itemId: string, data: {
  storageKey: string;
  url: string;
  label: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
}) {
  const item = await one<{ id: string }>('SELECT id FROM items WHERE id = $1', [itemId]);
  if (!item) throw new AppError(40401, '这个计价主体不存在。', 404);
  const rows = await q<{ id: string; sort_order: number; created_at: Date }>(
    `INSERT INTO item_images (item_id, storage_key, url, label, width, height, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, sort_order, created_at`,
    [itemId, data.storageKey, data.url, data.label, data.width, data.height, data.sortOrder],
  );
  const r = rows[0]!;
  return {
    id: r.id,
    storage_key: data.storageKey,
    thumb_key: null,
    url: data.url,
    thumb_url: null,
    original_name: data.label ?? '',
    mime: '',
    size_bytes: 0,
    width: data.width,
    height: data.height,
    sort_order: r.sort_order,
    note: null,
    created_at: r.created_at.toISOString(),
  };
}

export async function deleteImage(itemId: string, imageId: string) {
  // 必须 RETURNING：不带 RETURNING 的 DELETE 永远回 0 行，
  // 拿行数判"存不存在"会把一次成功的删除报成 404。
  const r = await q<{ id: string }>(
    'DELETE FROM item_images WHERE id = $1 AND item_id = $2 RETURNING id',
    [imageId, itemId],
  );
  if (r.length === 0) {
    const exists = await one<{ id: string }>('SELECT id FROM item_images WHERE id = $1', [imageId]);
    if (!exists) throw new AppError(40401, '这张图片不存在。', 404);
    // 图片存在但挂在别的主体下：说明前端拿错了 item_id，不能装作删成功
    throw new AppError(40401, '这张图片属于另一个计价主体。', 404);
  }
  return { deleted: true };
}

export async function addLink(itemId: string, data: { label: string; url: string; sortOrder: number }) {
  const item = await one<{ id: string }>('SELECT id FROM items WHERE id = $1', [itemId]);
  if (!item) throw new AppError(40401, '这个计价主体不存在。', 404);
  if (!/^https?:\/\/.+/.test(data.url)) {
    throw new AppError(40001, '链接必须是 http(s):// 开头。', 400, { field: 'url' });
  }
  const rows = await q<{ id: string; url: string; label: string | null; created_at: Date }>(
    `INSERT INTO item_links (item_id, url, label) VALUES ($1,$2,$3) RETURNING id, url, label, created_at`,
    [itemId, data.url, data.label],
  );
  const r = rows[0]!;
  return { id: r.id, label: r.label ?? '', url: r.url, platform: null, note: null, sort_order: data.sortOrder };
}

/**
 * label 允许显式传 null：外链标签是可空的展示字段，
 * 传 null 表示"清空标签"，与"没传这个字段"（保持原值）必须区分开。
 */
export async function patchLink(itemId: string, linkId: string, data: { label?: string | null; url?: string }) {
  const current = await one<{ id: string; url: string; label: string | null }>(
    'SELECT id, url, label FROM item_links WHERE id = $1 AND item_id = $2',
    [linkId, itemId],
  );
  if (!current) throw new AppError(40401, '这个外链不存在。', 404);
  const url = data.url ?? current.url;
  if (!/^https?:\/\/.+/.test(url)) {
    throw new AppError(40001, '链接必须是 http(s):// 开头。', 400, { field: 'url' });
  }
  const rows = await q<{ id: string; url: string; label: string | null }>(
    'UPDATE item_links SET url=$2, label=$3 WHERE id=$1 RETURNING id, url, label',
    [linkId, url, data.label !== undefined ? data.label : current.label],
  );
  const r = rows[0]!;
  return { id: r.id, label: r.label ?? '', url: r.url, platform: null, note: null, sort_order: 0 };
}

export async function deleteLink(itemId: string, linkId: string) {
  const rows = await q('DELETE FROM item_links WHERE id = $1 AND item_id = $2 RETURNING id', [linkId, itemId]);
  if (rows.length === 0) throw new AppError(40401, '这个外链不存在。', 404);
  return { deleted: true };
}
