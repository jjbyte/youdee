import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { logout } from '@/server/services/auth.service';

export const POST = route(async () => {
  await requireUser();
  await logout();
  return ok(null);
});
