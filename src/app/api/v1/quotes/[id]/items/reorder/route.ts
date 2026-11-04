import { AppError, body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { reorderItems } from '@/server/services/quote-line.service';

export const PATCH = route(async (req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const b = await body<{ ordered_ids?: unknown[] }>(req);
  if (!Array.isArray(b.ordered_ids)) {
    throw new AppError(40001, 'ordered_ids 必须是数组。', 400, { field: 'ordered_ids' });
  }
  const ids = b.ordered_ids.map((id) => reqUuid(id, 'ordered_ids'));
  return ok(await reorderItems(quoteId, ids));
});
