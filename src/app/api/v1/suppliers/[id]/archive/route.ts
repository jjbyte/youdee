import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setSupplierActive } from '@/server/services/suppliers.service';

/** 作废（停用）：成员也能做。作废后不再出现在录价与比价的可选供应商里 */
export const POST = route(async (_req, params) => {
  await requireArchive('作废供应商');
  return ok(await setSupplierActive(reqUuid(params.id, 'id'), false));
});
