import { ok, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deletePriceAttachment } from '@/server/services/price-attachment.service';

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除报价附件');
  await deletePriceAttachment(reqUuid(params.id, 'id'), reqUuid(params.attachmentId, 'attachmentId'));
  return ok(null);
});
