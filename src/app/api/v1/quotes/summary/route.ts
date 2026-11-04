import { ok, requireUser, searchParams } from '@/server/http';
import { dateParam, enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { quotesSummary } from '@/server/services/quote-summary.service';

/**
 * 台账统计。group_by=project_type 时才返回按类型的聚合（要 JOIN 阈值表，
 * 前端拿不到阈值，所以这个聚合只能在服务端做）。
 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  return ok(
    await quotesSummary({
      from: dateParam(sp, 'from'),
      to: dateParam(sp, 'to'),
      groupBy: enumParam(sp, 'group_by', ['project_type', 'status'] as const),
    }),
  );
});
