import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { markAllRead } from '@/server/services/notifications.service';

export const POST = route(async () => {
  const user = await requireUser();
  return ok({ updated: await markAllRead(user.id) });
});
