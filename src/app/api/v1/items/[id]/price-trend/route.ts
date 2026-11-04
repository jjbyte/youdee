import { AppError, ok, requireUser, reqUuid, searchParams } from '@/server/http';
import { dateParam, enumParam, uuidListParam } from '@/server/params';
import { route } from '@/server/wrap';
import { PRICING_NATURES } from '@/domain/units';
import { priceTrend } from '@/server/services/price-trend.service';

export const GET = route(async (req, params) => {
  await requireUser();
  const itemId = reqUuid(params.id, 'id');
  const sp = searchParams(req);
  const from = dateParam(sp, 'from');
  const to = dateParam(sp, 'to');
  if (!from || !to) throw new AppError(40001, '必须给出 from 与 to 日期。', 400, { field: 'from' });
  const tier = sp.get('tier_min_qty') ?? '1';
  const result = await priceTrend(itemId, {
    from,
    to,
    supplierIds: uuidListParam(sp, 'supplier_ids'),
    nature: enumParam(sp, 'pricing_nature', PRICING_NATURES),
    tierMinQty: tier,
  });
  if (!result) throw new AppError(40401, '这个计价主体不存在。', 404);
  return ok(result);
});
