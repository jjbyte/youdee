import { boolParam, ok, requireUser, searchParams } from '@/server/http';
import { pageQuery } from '@/server/params';
import { route } from '@/server/wrap';
import { listNotifications } from '@/server/services/notifications.service';

/** 只读本人：通知不是监控，管理员也看不到别人的 */
export const GET = route(async (req) => {
  const user = await requireUser();
  const sp = searchParams(req);
  const page = pageQuery(sp);
  return ok(await listNotifications(user.id, boolParam(sp, 'unread_only') === true, page.limit, page.offset));
});
