import { body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { applyMargin } from '@/server/services/quote-line-margin.service';

export const POST = route(async (req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const b = await body<{ item_ids?: unknown[] }>(req).catch(() => ({ item_ids: undefined }));
  const ids = Array.isArray(b.item_ids) ? b.item_ids.map((id) => reqUuid(id, 'item_ids')) : null;
  return ok(await applyMargin(quoteId, ids));
});
