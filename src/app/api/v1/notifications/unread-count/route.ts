import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { unreadCount } from '@/server/services/notifications.service';

export const GET = route(async () => {
  const user = await requireUser();
  return ok({ unread: await unreadCount(user.id) });
});
