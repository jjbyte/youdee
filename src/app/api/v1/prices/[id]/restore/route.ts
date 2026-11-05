import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { restorePrice } from '@/server/services/price-patch.service';

/** 撤销作废。成员也能做；撞上同口径在效价会 40902 并说明撞的是哪家 */
export const POST = route(async (_req, params) => {
  const actor = await requireArchive('恢复价格');
  return ok(await restorePrice(reqUuid(params.id, 'id'), actor));
});
