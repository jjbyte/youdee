import { AppError, ok, requireUser, reqUuid, searchParams } from '@/server/http';
import { dateParam, enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { today } from '@/server/db';
import { defaultTaxBasis } from '@/server/store/settings.store';
import { parseMoney } from '@/domain/money';
import { PRICING_NATURES } from '@/domain/units';
import { compareForItem } from '@/server/services/compare.service';

/**
 * 多供应商并排比价。
 * qty_base 是「比价基准单位」的数量（架构文档里的 qty，两个名字都收）。
 * tax_basis 不传时取 app_settings 默认口径：比价必须有一个确定的口径，
 * 否则含税与不含税会被塞进同一组排序。
 */
export const GET = route(async (req, params) => {
  await requireUser();
  const itemId = reqUuid(params.id, 'id');
  const sp = searchParams(req);
  const qtyRaw = sp.get('qty_base') ?? sp.get('qty') ?? '1';
  const qty = qtyRaw.trim();
  if (!/^\d+(\.\d+)?$/.test(qty) || parseMoney(qty) <= 0n) {
    throw new AppError(40001, '数量必须是大于 0 的数字。', 400, { field: 'qty_base' });
  }
  const taxBasis = enumParam(sp, 'tax_basis', ['inclusive', 'exclusive'] as const) ?? (await defaultTaxBasis());
  const nature = enumParam(sp, 'nature', PRICING_NATURES)
    ?? enumParam(sp, 'pricing_nature', PRICING_NATURES);
  const onDate = dateParam(sp, 'on_date') ?? today();
  const result = await compareForItem(itemId, { qtyBase: qty, taxBasis, nature, onDate });
  if (!result) throw new AppError(40401, '这个计价主体不存在。', 404);
  return ok(result);
});
