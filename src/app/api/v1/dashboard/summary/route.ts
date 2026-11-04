import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { dashboardSummary } from '@/server/services/dashboard.service';

export const GET = route(async () => {
  const user = await requireUser();
  return ok(await dashboardSummary(user.id));
});
