import { body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { parseQuoteItemPatch } from '@/server/quote-item-body';
import { deleteItem, updateItem } from '@/server/services/quote-line.service';

export const PATCH = route(async (req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const itemId = reqUuid(params.itemId, 'itemId');
  const b = await body<Record<string, unknown>>(req);
  const result = await updateItem(quoteId, itemId, parseQuoteItemPatch(b));
  return ok({ item: result.item, quote_totals: result.quote_totals });
});

export const DELETE = route(async (_req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const itemId = reqUuid(params.itemId, 'itemId');
  return ok(await deleteItem(quoteId, itemId));
});
