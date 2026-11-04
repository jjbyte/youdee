import { AppError, intParam, ok, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { addImage } from '@/server/services/items-media.service';
import { saveUpload } from '@/server/services/upload.service';

export const POST = route(async (req, params) => {
  await requireAdmin('上传图片');
  const itemId = reqUuid(params.id, 'id');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new AppError(40001, '请选择要上传的文件。', 400, { field: 'file' });
  const saved = await saveUpload(file, `items/${itemId}`);
  const sortOrderRaw = form?.get('sort_order');
  const created = await addImage(itemId, {
    storageKey: saved.storageKey,
    url: saved.url,
    label: saved.originalName,
    width: null,
    height: null,
    sortOrder: sortOrderRaw ? Number(sortOrderRaw) : 0,
  });
  return ok(created, 201);
});
