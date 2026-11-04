import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { issueQuote } from '@/server/services/quote-actions.service';

/** 出单。只有「客户名/活动名空」「有行没成本」能拦；负毛利、软陈旧、非最低价一律放行 */
export const POST = route(async (_req, params) => {
  await requireUser();
  return ok(await issueQuote(reqUuid(params.id, 'id')));
});
