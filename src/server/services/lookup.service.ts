/**
 * 单条取价（`resolvePrice` 的唯一 SQL 实现）。
 *
 * 全项目只有这里能从「主体 + 性质 + 口径 + 日期 + 数量」解出一条价：
 * 拼单、草稿刷新价、切口径试算、self-check 的参考最低价全部调它。
 * 另写一个"差不多的"查询就会出现"提示里的价"和"落库的价"来自两段逻辑。
 *
 * 两个 × COALESCE(base_unit_qty,1)（数量换算与单价归一）都是乘法口径，
 * 任一处改成除法，比价结果会整体偏差 base_unit_qty² 倍且不报错。
 */
import { q } from '../db';
import { derivePriceState } from '@/domain/price-resolve';
import { applyConversion, fmtPrice, parseMoney } from '@/domain/money';
import { unitModeOf } from '@/domain/units';
import type { TaxBasis } from '../store/settings.store';

export interface ResolveParams {
  itemId: string;
  /** 比价基准单位数量 */
  qty: string;
  pricingNature: string;
  taxBasis: TaxBasis;
  onDate: string;
  supplierId?: string | null;
  /** 时间类单位必须定到「按天/按场/…」，否则同一主体可能同时存在两条 */
  unitMode?: string | null;
}

export interface ResolvedPrice {
  priceId: string;
  supplierId: string;
  supplierName: string;
  supplierType: string;
  unitCode: string;
  baseUnitQty: string | null;
  unitPrice: string;
  tierMinQty: string | null;
  tierUnitPrice: string;
  baseUnitPrice: string;
  qtyPriced: string;
  taxIncluded: boolean;
  moq: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceNote: string | null;
  effectiveState: string;
  stalenessDays: number;
  moqWarning: boolean;
  tierBelowMin: boolean;
}

interface Row {
  price_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  unit_code: string;
  base_unit_qty: string | null;
  unit_price: string;
  tier_min_qty: string | null;
  tier_unit_price: string | null;
  base_unit_price: string;
  qty_priced: string;
  tax_included: boolean;
  moq: string | null;
  effective_from: string;
  effective_to: string | null;
  source_note: string | null;
  status: string;
  last_used_at: Date | null;
  updated_at: Date;
  has_tiers: boolean;
}

const RESOLVE_SQL = `
SELECT p.id AS price_id, p.supplier_id, s.name AS supplier_name, s.type AS supplier_type,
       p.unit_code, p.base_unit_qty, p.unit_price, p.tax_included, p.moq,
       p.effective_from, p.effective_to, p.source_note, p.status, p.last_used_at, p.updated_at,
       t.min_qty AS tier_min_qty, t.unit_price AS tier_unit_price,
       ROUND($2::numeric * COALESCE(p.base_unit_qty, 1), 3) AS qty_priced,
       ROUND(COALESCE(t.unit_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) AS base_unit_price,
       EXISTS (SELECT 1 FROM price_tiers x WHERE x.price_id = p.id) AS has_tiers
  FROM prices p
  JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
  LEFT JOIN LATERAL (
    SELECT ti.min_qty, ti.unit_price
      FROM price_tiers ti
     WHERE ti.price_id = p.id
       AND ti.min_qty <= ($2::numeric * COALESCE(p.base_unit_qty, 1))
     ORDER BY ti.min_qty DESC
     LIMIT 1
  ) t ON TRUE
 WHERE p.item_id = $1
   AND p.pricing_nature = $3
   AND p.tax_included = ($4 = 'inclusive')
   AND p.unit_mode IS NOT DISTINCT FROM $5
   AND p.status = 'active'
   AND p.effective_from <= $6::date
   AND (p.effective_to IS NULL OR p.effective_to >= $6::date)
   AND ($7::uuid IS NULL OR p.supplier_id = $7::uuid)
 ORDER BY ROUND(COALESCE(t.unit_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) ASC,
          p.effective_from DESC
 LIMIT 1`;

export async function resolveOne(
  p: ResolveParams,
  staleDays: number,
): Promise<ResolvedPrice | null> {
  const rows = await q<Row>(RESOLVE_SQL, [
    p.itemId,
    p.qty,
    p.pricingNature,
    p.taxBasis,
    p.unitMode ?? null,
    p.onDate,
    p.supplierId ?? null,
  ]);
  const r = rows[0];
  if (!r) return null;
  const state = derivePriceState({
    status: r.status as 'active' | 'superseded' | 'archived',
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
    onDate: p.onDate,
    staleDaysThreshold: staleDays,
  });
  const moqWarning = r.moq !== null && Number(r.qty_priced) < Number(r.moq);
  return {
    priceId: r.price_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierType: r.supplier_type,
    unitCode: r.unit_code,
    baseUnitQty: r.base_unit_qty,
    unitPrice: r.unit_price,
    tierMinQty: r.tier_min_qty,
    tierUnitPrice: r.tier_unit_price ?? r.unit_price,
    baseUnitPrice: r.base_unit_price,
    qtyPriced: r.qty_priced,
    taxIncluded: r.tax_included,
    moq: r.moq,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    sourceNote: r.source_note,
    effectiveState: state.state,
    stalenessDays: state.stalenessDays,
    moqWarning,
    tierBelowMin: r.has_tiers && r.tier_min_qty === null,
  };
}

export interface OtherBasisInfo {
  exists: boolean;
  taxIncluded: boolean | null;
  price: string | null;
  priceId: string | null;
}

/**
 * 「另一个口径有没有价」——只用于提示文案。
 * 这个值绝不能回填到 cost_unit_price：含税单拿不含税成本会让毛利虚高，
 * 而两个数看起来都正常，打标救不了它。
 */
export async function otherBasis(
  p: Omit<ResolveParams, 'taxBasis'>,
  currentBasis: TaxBasis,
  staleDays: number,
): Promise<OtherBasisInfo> {
  const other: TaxBasis = currentBasis === 'inclusive' ? 'exclusive' : 'inclusive';
  const hit = await resolveOne({ ...p, taxBasis: other }, staleDays);
  if (!hit) return { exists: false, taxIncluded: null, price: null, priceId: null };
  return { exists: true, taxIncluded: hit.taxIncluded, price: hit.baseUnitPrice, priceId: hit.priceId };
}

/** 该主体缺省计价方式（时间类单位才有值），取价/比价未指定时用它 */
export function defaultUnitMode(baseUnitCode: string, compareUnitCode: string | null): string | null {
  return unitModeOf(compareUnitCode ?? baseUnitCode) ?? unitModeOf(baseUnitCode);
}

export interface ItemBrief {
  id: string;
  item_type: string;
  name: string;
  spec: string | null;
  base_unit_code: string;
  base_unit_name: string;
  compare_unit_code: string | null;
  compare_unit_name: string | null;
}

export async function itemBrief(itemId: string): Promise<ItemBrief | null> {
  const rows = await q<ItemBrief>(
    `SELECT i.id, i.item_type, i.name, i.spec, i.base_unit_code, bu.name_zh AS base_unit_name,
            i.compare_unit_code, cu.name_zh AS compare_unit_name
       FROM items i
       JOIN units bu ON bu.code = i.base_unit_code
       LEFT JOIN units cu ON cu.code = i.compare_unit_code
      WHERE i.id = $1`,
    [itemId],
  );
  return rows[0] ?? null;
}

export interface ReferenceLowest {
  price: string | null;
  supplierId: string | null;
  supplierName: string | null;
}

/**
 * 录单那一刻「同性质 + 同口径 + 同计价方式」的最低价快照（自检 R3 的对照物）。
 * 三个同组条件缺一不可：只按主体比会拿租价去劝买断单"你贵了"，
 * 这条提醒会从最有价值变成最危险（用户更信"系统说的"）。
 */
export async function referenceLowest(
  itemId: string,
  pricingNature: string,
  taxIncluded: boolean,
  unitMode: string | null,
  onDate: string,
): Promise<ReferenceLowest> {
  const rows = await q<{ base_unit_price: string; supplier_id: string; supplier_name: string }>(
    `SELECT ROUND(COALESCE(t.unit_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) AS base_unit_price,
            p.supplier_id, s.name AS supplier_name
       FROM prices p
       JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
       LEFT JOIN LATERAL (
         SELECT ti.unit_price FROM price_tiers ti
          WHERE ti.price_id = p.id AND ti.min_qty <= 1 ORDER BY ti.min_qty DESC LIMIT 1
       ) t ON TRUE
      WHERE p.item_id = $1 AND p.pricing_nature = $2 AND p.tax_included = $3
        AND p.unit_mode IS NOT DISTINCT FROM $4
        AND p.status = 'active'
        AND p.effective_from <= $5::date AND (p.effective_to IS NULL OR p.effective_to >= $5::date)
      ORDER BY ROUND(COALESCE(t.unit_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) ASC
      LIMIT 1`,
    [itemId, pricingNature, taxIncluded, unitMode, onDate],
  );
  const r = rows[0];
  return r
    ? { price: r.base_unit_price, supplierId: r.supplier_id, supplierName: r.supplier_name }
    : { price: null, supplierId: null, supplierName: null };
}

/** 折算工具复用（导出给 quote 服务用，避免各处再写一遍乘法） */
export function normalizeToBaseUnit(unitPrice: string, baseUnitQty: string | null): string {
  return fmtPrice(applyConversion(parseMoney(unitPrice), baseUnitQty), 4);
}
