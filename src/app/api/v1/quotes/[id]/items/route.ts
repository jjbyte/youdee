import { body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { parseQuoteItemCreate } from '@/server/quote-item-body';
import { addItems } from '@/server/services/quote-line.service';

export const POST = route(async (req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const result = await addItems(quoteId, [parseQuoteItemCreate(b)]);
  return ok({ item: result.item, quote_totals: result.quote_totals }, 201);
});
