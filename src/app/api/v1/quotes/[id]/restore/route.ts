import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { restoreQuote } from '@/server/services/quote-actions.service';

/** 撤销作废。成员也能用——作废是可逆动作，才允许成员做 */
export const POST = route(async (_req, params) => {
  await requireArchive('撤销作废');
  return ok(await restoreQuote(reqUuid(params.id, 'id')));
});
