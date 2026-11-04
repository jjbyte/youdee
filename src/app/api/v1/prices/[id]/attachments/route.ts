import { AppError, ok, optStr, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { addPriceAttachment } from '@/server/services/price-attachment.service';

export const POST = route(async (req, params) => {
  await requireAdmin('上传报价附件');
  const priceId = reqUuid(params.id, 'id');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new AppError(40001, '请选择要上传的文件。', 400, { field: 'file' });
  const note = form?.get('note');
  const created = await addPriceAttachment(priceId, file, optStr(note, 200));
  return ok(created, 201);
});
