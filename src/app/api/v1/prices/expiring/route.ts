import { intParam, ok, requireUser, searchParams } from '@/server/http';
import { enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { listExpiring } from '@/server/services/price-read.service';

/** expiring = 快到期；stale = 太久没核价。两个 mode 对应两种不同的维护动作 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const mode = enumParam(sp, 'mode', ['expiring', 'stale'] as const) ?? 'expiring';
  const days = intParam(sp, 'days', 30, 1, 365);
  return ok(await listExpiring(mode, days));
});
