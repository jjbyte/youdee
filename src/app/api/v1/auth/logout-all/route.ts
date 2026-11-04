import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { logoutAll } from '@/server/services/auth.service';

/** 退出所有设备：token_version + 1，已签发的令牌立刻失效，不用等 7 天自然过期 */
export const POST = route(async () => {
  const user = await requireUser();
  await logoutAll(user.id);
  return ok(null);
});
