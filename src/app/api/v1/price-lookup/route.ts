import { AppError, ok, requireUser, reqUuid, searchParams } from '@/server/http';
import { dateParam, enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { today } from '@/server/db';
import { staleDaysThreshold } from '@/server/store/settings.store';
import { PRICING_NATURES } from '@/domain/units';
import {
  defaultUnitMode, itemBrief, otherBasis, resolveOne,
} from '@/server/services/lookup.service';

/**
 * 单条取价（拼单用）。
 * tax_basis 必传且**无回落**：本单声明什么口径就取哪条价，
 * 该口径没有价时返回 42205，绝不拿另一口径的价顶替（含税单拿不含税成本会让毛利虚高）。
 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const itemId = reqUuid(sp.get('item_id'), 'item_id');
  const qtyRaw = (sp.get('qty') ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(qtyRaw) || Number(qtyRaw) <= 0) {
    throw new AppError(40001, '数量必须是大于 0 的数字。', 400, { field: 'qty' });
  }
  const nature = enumParam(sp, 'pricing_nature', PRICING_NATURES);
  if (!nature) throw new AppError(40001, '必须指定交易性质（买断/租赁/定制/服务不可混比）。', 400, { field: 'pricing_nature' });
  const taxBasis = enumParam(sp, 'tax_basis', ['inclusive', 'exclusive'] as const);
  if (!taxBasis) throw new AppError(40001, '必须声明本单的税口径。', 400, { field: 'tax_basis' });

  const item = await itemBrief(itemId);
  if (!item) throw new AppError(40401, '这个计价主体不存在。', 404);

  const onDate = dateParam(sp, 'on_date') ?? today();
  const supplierRaw = sp.get('supplier_id');
  const supplierId = supplierRaw ? reqUuid(supplierRaw, 'supplier_id') : null;
  const unitMode = enumParam(sp, 'unit_mode', [
    'per_day', 'per_event', 'per_person_day', 'per_hour', 'per_half_day',
  ] as const) ?? defaultUnitMode(item.base_unit_code, item.compare_unit_code);

  const stale = await staleDaysThreshold();
  const params = {
    itemId,
    qty: qtyRaw,
    pricingNature: nature,
    taxBasis,
    onDate,
    supplierId,
    unitMode,
  };
  const hit = await resolveOne(params, stale);

  if (!hit) {
    const other = await otherBasis(
      { itemId, qty: qtyRaw, pricingNature: nature, onDate, supplierId, unitMode },
      taxBasis,
      stale,
    );
    throw new AppError(
      42205,
      `${item.name} 在${taxBasis === 'inclusive' ? '含税' : '不含税'}口径下、${onDate} 没有有效价格。`
        + (other.exists
          ? `这家只报了${other.taxIncluded ? '含税' : '不含税'}价 ¥${other.price}，本单口径不同，不能直接顶替 —— 请让供应商补报，或手工填成本。`
          : '可以手工填成本，或先让供应商报一条价。'),
      422,
      {
        field: 'tax_basis',
        detail: {
          item_id: itemId,
          supplier_id: supplierId,
          pricing_nature: nature,
          tax_basis: taxBasis,
          on_date: onDate,
          other_basis_exists: other.exists,
          other_basis_tax_included: other.taxIncluded,
          other_basis_price: other.price,
          other_basis_price_id: other.priceId,
        },
      },
    );
  }

  return ok({
    item_id: item.id,
    item_type: item.item_type,
    item_name: item.name,
    item_spec: item.spec,
    base_unit_code: item.compare_unit_code ?? item.base_unit_code,
    base_unit_name: item.compare_unit_name ?? item.base_unit_name,
    qty: qtyRaw,
    pricing_nature: nature,
    qty_priced: hit.qtyPriced,
    on_date: onDate,
    base_unit_price: hit.baseUnitPrice,
    moq_warning: hit.moqWarning,
    tier_below_min: hit.tierBelowMin,
    resolved_from: {
      price_id: hit.priceId,
      supplier_id: hit.supplierId,
      supplier_name: hit.supplierName,
      supplier_type: hit.supplierType,
      unit_code: hit.unitCode,
      base_unit_qty: hit.baseUnitQty,
      tier_min_qty: hit.tierMinQty,
      tier_unit_price: hit.tierUnitPrice,
      tax_included: hit.taxIncluded,
      effective_state: hit.effectiveState,
      staleness_days: hit.stalenessDays,
      moq: hit.moq,
      effective_from: hit.effectiveFrom,
      effective_to: hit.effectiveTo,
      source_note: hit.sourceNote,
    },
  });
});
