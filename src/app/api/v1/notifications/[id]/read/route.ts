import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { markRead } from '@/server/services/notifications.service';

/** PATCH 与 POST 都收：文档写 PATCH，前端"点一下"用 POST 更自然 */
export const PATCH = route(async (_req, params) => {
  const user = await requireUser();
  return ok(await markRead(user.id, reqUuid(params.id, 'id')));
});

export const POST = PATCH;
