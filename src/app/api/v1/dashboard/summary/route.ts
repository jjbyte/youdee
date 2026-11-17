import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { dashboardSummary } from '@/server/services/dashboard.service';

export const GET = route(async () => {
  const user = await requireUser();
  // 传整个用户而不是只传 id：合同到期那一块要按角色决定给不给（见 dashboard.service）
  return ok(await dashboardSummary(user));
});
