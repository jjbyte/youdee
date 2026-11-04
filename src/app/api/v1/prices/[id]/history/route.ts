import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { priceHistory } from '@/server/services/price-read.service';

export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await priceHistory(reqUuid(params.id, 'id')));
});
