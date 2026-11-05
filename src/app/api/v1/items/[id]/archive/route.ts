import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setItemActive } from '@/server/services/items-write.service';

/** 作废（停用）：成员也能做。可逆，所以不设管理员闸门 */
export const POST = route(async (_req, params) => {
  await requireArchive('作废');
  return ok(await setItemActive(reqUuid(params.id, 'id'), false));
});
