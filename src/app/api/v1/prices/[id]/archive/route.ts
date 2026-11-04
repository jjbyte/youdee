import { body, ok, optStr, requireOverridePrice, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { archivePrice } from '@/server/services/price-patch.service';

/** 归档 = 不再参与比价与取价，历史仍可查。录错了用归档，不要删 */
export const POST = route(async (req, params) => {
  const actor = await requireOverridePrice();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ reason?: string }>(req).catch(() => ({ reason: undefined }));
  return ok(await archivePrice(id, optStr(b.reason, 200), actor));
});
