/**
 * 比价的取数层：把「该主体当日全部非 archived 价格 + 阶梯」取成 CompareRawRow[]。
 *
 * 不做 DISTINCT ON、不做分组：分组与标最低全在 domain/compare.ts（纯函数，有单测）。
 * 这里一旦顺手"只取每家最便宜那条"，不可比的行就会消失 —— 而"这家有货但单位没法比"
 * 正是报价员最需要看到的那一行。
 */
import { q } from '../db';
import type { CompareRawRow } from '@/domain/compare';
import type { PricingNature, SupplierType, UnitMode } from '@/domain/units';

interface RawRow {
  price_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  pricing_nature: string;
  unit_mode: string | null;
  unit_code: string;
  base_unit_qty: string | null;
  unit_price: string;
  tax_included: boolean;
  moq: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  last_used_at: Date | null;
  updated_at: Date;
  default_lead_time_days: number | null;
}

export async function compareRawRows(itemId: string, onDate: string): Promise<CompareRawRow[]> {
  const rows = await q<RawRow>(
    `SELECT p.id AS price_id, p.supplier_id, s.name AS supplier_name, s.type AS supplier_type,
            p.pricing_nature, p.unit_mode, p.unit_code, p.base_unit_qty, p.unit_price,
            p.tax_included, p.moq, p.effective_from, p.effective_to, p.status,
            p.last_used_at, p.updated_at, s.default_lead_time_days
       FROM prices p
       JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
      WHERE p.item_id = $1
        AND p.status = 'active'
        AND p.effective_from <= $2::date
        AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
      ORDER BY p.pricing_nature, p.unit_mode NULLS FIRST, p.effective_from DESC`,
    [itemId, onDate],
  );
  if (rows.length === 0) return [];
  const tierRows = await q<{ price_id: string; min_qty: string; unit_price: string }>(
    `SELECT price_id, min_qty, unit_price FROM price_tiers
      WHERE price_id = ANY($1::uuid[]) ORDER BY min_qty`,
    [rows.map((r) => r.price_id)],
  );
  const tiers = new Map<string, Array<{ minQty: string; unitPrice: string }>>();
  for (const t of tierRows) {
    const list = tiers.get(t.price_id) ?? [];
    list.push({ minQty: t.min_qty, unitPrice: t.unit_price });
    tiers.set(t.price_id, list);
  }
  return rows.map((r) => ({
    priceId: r.price_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierType: r.supplier_type as SupplierType,
    pricingNature: r.pricing_nature as PricingNature,
    unitCode: r.unit_code,
    baseUnitQty: r.base_unit_qty,
    unitPrice: r.unit_price,
    moq: r.moq,
    taxIncluded: r.tax_included,
    unitMode: (r.unit_mode ?? null) as UnitMode | null,
    tiers: tiers.get(r.price_id) ?? [],
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status as 'active' | 'superseded' | 'archived',
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
    leadTimeDays: r.default_lead_time_days,
  }));
}
