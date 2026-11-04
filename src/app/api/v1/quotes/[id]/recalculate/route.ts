import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { recalculate } from '@/server/services/quote-line-margin.service';

/** 重算 = 自洽性检查：库内金额与重算不一致时会修正并在 warnings 里说出来，不静默修 */
export const POST = route(async (req, params) => {
  const actor = await requireUser();
  return ok(await recalculate(reqUuid(params.id, 'id'), actor));
});
