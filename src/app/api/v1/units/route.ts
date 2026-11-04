import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { listUnits } from '@/server/services/units.service';

/** 单位字典是只读种子数据：单位是口径的一部分，让用户随手加单位等于让比价失去基准 */
export const GET = route(async () => {
  await requireUser();
  return ok(await listUnits());
});
