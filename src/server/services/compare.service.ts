/**
 * 比价 DTO 组装。
 *
 * 分组与标最低全部委托 domain/compare.ts（纯函数，有单测），
 * 这里只做「CompareRawRow[] → 响应体」的搬运，绝不在搬运过程中算价。
 *
 * 一条硬约束：不可比的行**必须留在结果里**并带 exclusive_reason。
 * 过滤掉"这家有货但单位没法比"，用户永远不会想起来补折算系数，
 * 也永远以为这家没报价 —— 那才是真正贵的错误。
 */
import { q } from '../db';
import {
  computeComparison,
  type CompareGroup,
  type CompareRow,
} from '@/domain/compare';
import { applyConversion, fmtPrice, parseMoney, parseQty, qtyToPricingUnit, fmtQty } from '@/domain/money';
import type { PricingNature } from '@/domain/units';
import { PRICING_NATURE_LABELS, UNIT_MODE_LABELS } from '@/domain/units';
import { staleDaysThreshold, type TaxBasis } from '../store/settings.store';
import { itemBrief } from './lookup.service';
import { compareRawRows } from './compare-raw.service';

type GroupReason = 'MIXED_BASIS' | 'ONLY_OTHER_BASIS' | 'NO_COMPARABLE_UNIT' | 'SINGLE_ROW' | null;

interface OutRow {
  price_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  unit_code: string;
  base_unit_qty: string | null;
  qty_priced: string;
  tier_min_qty: string | null;
  tier_unit_price: string;
  tiers: Array<{ min_qty: string; max_qty: string | null; unit_price: string; base_unit_price: string }>;
  base_unit_price: string;
  compare_state: string;
  is_lowest: boolean;
  tax_included: boolean;
  effective_state: string;
  staleness_days: number;
  moq: string | null;
  effective_from: string;
  effective_to: string | null;
  default_lead_time_days: number | null;
  source_note: string | null;
  exclusive_reason: string | null;
  warnings: string[];
}

function tierBasePrice(unitPrice: string, baseUnitQty: string | null): string {
  if (baseUnitQty === null) return fmtPrice(parseMoney(unitPrice), 4);
  return fmtPrice(applyConversion(parseMoney(unitPrice), baseUnitQty), 4);
}

function mapRow(r: CompareRow, qtyBase: string): OutRow {
  const sorted = [...r.tiers].sort((a, b) => Number(a.minQty) - Number(b.minQty));
  // 数量必须用 parseQty（scale 2）：qtyToPricingUnit 的入参是 scale 2 数量。
  // 用 parseMoney（scale 4）喂进去会整体放大 100 倍，qty_priced 变成「1 套」显示成 100 套，
  // 档位命中与起订量提示跟着一起错，而且不报错 —— 这类错只有对数字才看得出来。
  const qty = parseQty(qtyBase);
  const qtyPriced = r.baseUnitQty === null ? fmtQty(qty) : fmtQty(qtyToPricingUnit(qty, r.baseUnitQty));
  // 命中档位：最后一个 min_qty <= qty_priced 的档（无阶梯时为 null，表示用的是基准档价）
  const matched = sorted.filter((t) => Number(t.minQty) <= Number(qtyPriced)).pop() ?? sorted[0] ?? null;
  return {
    price_id: r.priceId,
    supplier_id: r.supplierId,
    supplier_name: r.supplierName,
    supplier_type: r.supplierType,
    unit_code: r.unitCode,
    base_unit_qty: r.baseUnitQty,
    qty_priced: qtyPriced,
    tier_min_qty: sorted.length === 0 ? null : matched ? matched.minQty : null,
    tier_unit_price: r.unitPriceAtQty,
    tiers: sorted.map((t, i) => {
      const next = sorted[i + 1];
      return {
        min_qty: t.minQty,
        max_qty: next ? String(Number(next.minQty) - 1) : null,
        unit_price: t.unitPrice,
        base_unit_price: tierBasePrice(t.unitPrice, r.baseUnitQty),
      };
    }),
    base_unit_price: r.baseUnitPrice ?? fmtPrice(parseMoney(r.unitPriceAtQty), 4),
    compare_state: r.compareState,
    is_lowest: r.isLowest,
    tax_included: r.taxIncluded,
    effective_state: r.effectiveState,
    staleness_days: r.stalenessDays,
    moq: r.moq,
    effective_from: r.effectiveFrom,
    effective_to: r.effectiveTo,
    default_lead_time_days: r.leadTimeDays ?? null,
    source_note: null,
    exclusive_reason: r.exclusiveReason,
    warnings: r.warnings,
  };
}

/**
 * 组级不可比原因。注意 ONLY_OTHER_BASIS 允许与 comparable=true 共存：
 * 组里 2 家可比、1 家只报了另一口径时，最低价仍然算得出来，
 * 但"还有一家报了另一个口径"这句话本身必须说出来，否则那家看起来像没报价。
 */
function groupReason(g: CompareGroup): { reason: GroupReason; basis: string | null } {
  const hasTax = g.rows.some((r) => r.exclusiveReason === 'TAX_BASIS_MISMATCH');
  const hasUnit = g.rows.some((r) => r.exclusiveReason === 'UNIT_NOT_COMPARABLE');
  if (hasTax) return { reason: 'ONLY_OTHER_BASIS', basis: 'tax' };
  if (hasUnit) return { reason: 'NO_COMPARABLE_UNIT', basis: 'unit' };
  if (g.comparableCount === 1) return { reason: 'SINGLE_ROW', basis: null };
  return { reason: null, basis: null };
}

export interface CompareQuery {
  qtyBase: string;
  taxBasis: TaxBasis;
  nature: PricingNature | null;
  onDate: string;
}

export async function compareForItem(itemId: string, query: CompareQuery) {
  const item = await itemBrief(itemId);
  if (!item) return null;
  const rows = await compareRawRows(itemId, query.onDate);
  const staleDays = await staleDaysThreshold();
  const groups = computeComparison({
    rows,
    compareUnitCode: item.compare_unit_code,
    qtyBase: query.qtyBase,
    taxBasis: query.taxBasis,
    onDate: query.onDate,
    staleDaysThreshold: staleDays,
    onlyNature: query.nature,
  });

  const outGroups = groups.map((g) => {
    const { reason, basis } = groupReason(g);
    const comparable = g.comparableCount >= 2 && g.lowestBaseUnitPrice !== null;
    const rowsOut = g.rows.map((r) => mapRow(r, query.qtyBase));
    if (!comparable) for (const r of rowsOut) r.is_lowest = false;
    return {
      pricing_nature: g.pricingNature,
      pricing_nature_label: PRICING_NATURE_LABELS[g.pricingNature] ?? g.pricingNature,
      pricing_mode: g.unitMode,
      pricing_mode_label: g.unitMode ? UNIT_MODE_LABELS[g.unitMode] : null,
      tax_basis: g.taxBasis,
      comparable,
      reason,
      basis_dimension: basis,
      lowest_base_unit_price: comparable ? g.lowestBaseUnitPrice : null,
      lowest_supplier_types: Array.from(
        new Set(g.rows.filter((r) => r.isLowest).map((r) => r.supplierType)),
      ),
      comparable_count: g.comparableCount,
      total_count: g.totalCount,
      rows: rowsOut,
    };
  });

  const present = new Set(rows.map((r) => r.supplierId));
  const missing = await q<{ supplier_id: string; supplier_name: string; supplier_type: string }>(
    `SELECT DISTINCT p.supplier_id, s.name AS supplier_name, s.type AS supplier_type
       FROM prices p JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
      WHERE p.item_id = $1`,
    [itemId],
  );

  const breakpoints = Array.from(
    new Set(rows.flatMap((r) => r.tiers.map((t) => Number(t.minQty)))),
  ).sort((a, b) => a - b);

  return {
    item: {
      id: item.id,
      item_type: item.item_type,
      name: item.name,
      base_unit_code: item.base_unit_code,
      base_unit_name: item.base_unit_name,
      compare_unit_code: item.compare_unit_code,
      compare_unit_name: item.compare_unit_name,
    },
    qty: query.qtyBase,
    on_date: query.onDate,
    tax_basis: query.taxBasis,
    tier_breakpoints: breakpoints,
    groups: outGroups,
    missing_suppliers: missing
      .filter((m) => !present.has(m.supplier_id))
      .map((m) => ({
        supplier_id: m.supplier_id,
        supplier_name: m.supplier_name,
        supplier_type: m.supplier_type,
        reason: 'NO_VALID_PRICE',
      })),
  };
}
