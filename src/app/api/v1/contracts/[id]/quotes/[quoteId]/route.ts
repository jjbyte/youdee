import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { unlinkQuote } from '@/server/services/contract.service';

/** 取消关联：只删边表那一行，报价单和合同都还在 */
export const DELETE = route(async (_req, params) => {
  await requireUser();
  return ok(await unlinkQuote(reqUuid(params.id, 'id'), reqUuid(params.quoteId, 'quoteId')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
