/**
 * 历史价格趋势（按交易性质 + 供应商分组，阶梯线不插值）。
 *
 * 只画"同一性质、同一计价方式"的线：买断价与租赁价画在同一张图上，
 * 折线的起伏会被读成"这家降价了"，而实际上换了一个交易性质。
 */
import { q } from '../db';
import { applyConversion, fmtPrice, parseMoney } from '@/domain/money';
import type { PricingNature } from '@/domain/units';
import { itemBrief } from './lookup.service';

export interface TrendQuery {
  from: string;
  to: string;
  supplierIds: string[] | null;
  nature: PricingNature | null;
  tierMinQty: string;
}

export async function priceTrend(itemId: string, query: TrendQuery) {
  const item = await itemBrief(itemId);
  if (!item) return null;
  const rows = await q<{
    supplier_id: string;
    supplier_name: string;
    supplier_type: string;
    pricing_nature: string;
    unit_mode: string | null;
    effective_from: string;
    effective_to: string | null;
    unit_code: string;
    base_unit_qty: string | null;
    tier_min_qty: string | null;
    tier_unit_price: string;
  }>(
    `SELECT s.id AS supplier_id, s.name AS supplier_name, s.type AS supplier_type,
            p.pricing_nature, p.unit_mode, p.effective_from, p.effective_to,
            p.unit_code, p.base_unit_qty,
            t.min_qty AS tier_min_qty,
            COALESCE(t.unit_price, p.unit_price) AS tier_unit_price
       FROM prices p
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN price_tiers t ON t.price_id = p.id AND t.min_qty = $4::numeric
      WHERE p.item_id = $1
        AND p.status <> 'archived'
        AND p.effective_from <= $3::date
        AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
        AND ($5::uuid[] IS NULL OR p.supplier_id = ANY($5::uuid[]))
        AND ($6::text IS NULL OR p.pricing_nature = $6::text)
      ORDER BY p.pricing_nature, s.name, p.effective_from`,
    [itemId, query.from, query.to, query.tierMinQty, query.supplierIds, query.nature],
  );

  const series = new Map<string, {
    supplier_id: string;
    supplier_name: string;
    supplier_type: string;
    pricing_nature: string;
    unit_mode: string | null;
    points: Array<Record<string, unknown>>;
  }>();
  for (const r of rows) {
    const key = `${r.pricing_nature}::${r.supplier_id}`;
    const entry = series.get(key) ?? {
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      supplier_type: r.supplier_type,
      pricing_nature: r.pricing_nature,
      unit_mode: r.unit_mode,
      points: [],
    };
    entry.points.push({
      effective_from: r.effective_from,
      effective_to: r.effective_to,
      tier_min_qty: r.tier_min_qty,
      tier_unit_price: r.tier_unit_price,
      base_unit_price: r.base_unit_qty === null
        ? fmtPrice(parseMoney(r.tier_unit_price), 4)
        : fmtPrice(applyConversion(parseMoney(r.tier_unit_price), r.base_unit_qty), 4),
      unit_code: r.unit_code,
    });
    series.set(key, entry);
  }

  return {
    item_id: item.id,
    item_name: item.name,
    base_unit_code: item.compare_unit_code ?? item.base_unit_code,
    series: Array.from(series.values()),
  };
}
