import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setSupplierActive } from '@/server/services/suppliers.service';

/** 恢复：成员也能做 */
export const POST = route(async (_req, params) => {
  await requireArchive('恢复供应商');
  return ok(await setSupplierActive(reqUuid(params.id, 'id'), true));
});
