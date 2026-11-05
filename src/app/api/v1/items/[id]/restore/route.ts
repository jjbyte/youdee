import { ok, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setItemActive } from '@/server/services/items-write.service';

/** 恢复：成员也能做 */
export const POST = route(async (_req, params) => {
  await requireArchive('恢复');
  return ok(await setItemActive(reqUuid(params.id, 'id'), true));
});
