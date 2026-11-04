import { AppError, body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { parseQuoteItemCreate } from '@/server/quote-item-body';
import { addItems } from '@/server/services/quote-line.service';

export const POST = route(async (req, params) => {
  await requireUser();
  const quoteId = reqUuid(params.id, 'id');
  const b = await body<{ items?: unknown[] }>(req);
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new AppError(40001, 'items 至少一条。', 400, { field: 'items' });
  }
  if (b.items.length > 100) throw new AppError(40001, '一次最多 100 条。', 400, { field: 'items' });
  const inputs = b.items.map((raw) => parseQuoteItemCreate(raw as Record<string, unknown>));
  const result = await addItems(quoteId, inputs);
  return ok({ items: result.items, quote_totals: result.quote_totals }, 201);
});
