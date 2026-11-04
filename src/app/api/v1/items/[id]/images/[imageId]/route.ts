import { AppError, body, ok, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { q } from '@/server/db';
import { deleteImage } from '@/server/services/items-media.service';

export const PATCH = route(async (req, params) => {
  await requireAdmin('调整图片顺序');
  const itemId = reqUuid(params.id, 'id');
  const imageId = reqUuid(params.imageId, 'imageId');
  const b = await body<{ sort_order?: number }>(req);
  const rows = await q<{
    id: string;
    storage_key: string;
    url: string;
    label: string | null;
    width: number | null;
    height: number | null;
    sort_order: number;
    created_at: Date;
  }>(
    'UPDATE item_images SET sort_order = $2 WHERE id = $1 AND item_id = $3 RETURNING *',
    [imageId, Number(b.sort_order ?? 0), itemId],
  );
  const r = rows[0];
  if (!r) throw new AppError(40401, '这张图片不存在。', 404);
  return ok({
    id: r.id,
    storage_key: r.storage_key,
    thumb_key: null,
    url: r.url,
    thumb_url: null,
    original_name: r.label ?? '',
    mime: '',
    size_bytes: 0,
    width: r.width,
    height: r.height,
    sort_order: r.sort_order,
    note: null,
    created_at: r.created_at.toISOString(),
  });
});

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除图片');
  await deleteImage(reqUuid(params.id, 'id'), reqUuid(params.imageId, 'imageId'));
  return ok(null);
});
