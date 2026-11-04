/**
 * 列表页的「底价摘要」。
 *
 * 每个 (交易性质, 计价方式) 一条最低价，**存在多个分组时不返回标量**：
 * 列表页没有 Tab、没有上下文，用户扫一眼「最低 ¥380」就记住了 ——
 * 那是全站最容易造成错单的一格（那 380 可能是按天租赁，而他要用买断）。
 */
import { q } from '../db';

export interface LowestSummary {
  is_multi_group: boolean;
  groups: Array<{
    pricing_nature: string;
    pricing_mode: string | null;
    group_lowest: string | null;
    unit_code: string;
    supplier_id: string | null;
    supplier_name: string | null;
    supplier_type: string | null;
  }>;
}

export async function lowestSummaries(
  itemIds: string[],
  taxIncluded: boolean,
  onDate: string,
): Promise<Map<string, LowestSummary>> {
  const out = new Map<string, LowestSummary>();
  if (itemIds.length === 0) return out;
  const rows = await q<{
    item_id: string;
    pricing_nature: string;
    unit_mode: string | null;
    unit_code: string;
    supplier_id: string;
    supplier_name: string;
    supplier_type: string;
    group_lowest: string;
  }>(
    `SELECT DISTINCT ON (p.item_id, p.pricing_nature, COALESCE(p.unit_mode, ''))
            p.item_id, p.pricing_nature, p.unit_mode,
            -- 单位必须用**比价单位**：group_lowest 是 unit_price × base_unit_qty，
            -- 已经折算到比价单位上了。这里若返回 p.unit_code（供应商原始录入单位，
            -- 比如"套"），就会出现「¥80.56/套」而真值是每㎡ 80.56——差 18 倍，
            -- 而且看起来完全正常。数字和单位必须同源。
            COALESCE(i.compare_unit_code, i.base_unit_code) AS unit_code,
            p.supplier_id,
            s.name AS supplier_name, s.type AS supplier_type,
            ROUND(COALESCE(t.tier_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) AS group_lowest
       FROM prices p
       JOIN items i ON i.id = p.item_id
       JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
       LEFT JOIN LATERAL (
         SELECT ti.unit_price AS tier_price FROM price_tiers ti
          WHERE ti.price_id = p.id AND ti.min_qty <= 1 ORDER BY ti.min_qty DESC LIMIT 1
       ) t ON TRUE
      WHERE p.item_id = ANY($1::uuid[]) AND p.status = 'active' AND p.tax_included = $3
        AND p.effective_from <= $2::date
        AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
      ORDER BY p.item_id, p.pricing_nature, COALESCE(p.unit_mode, ''),
               ROUND(COALESCE(t.tier_price, p.unit_price) * COALESCE(p.base_unit_qty, 1), 4) ASC,
               s.name`,
    [itemIds, onDate, taxIncluded],
  );
  for (const r of rows) {
    const entry = out.get(r.item_id) ?? { is_multi_group: false, groups: [] };
    entry.groups.push({
      pricing_nature: r.pricing_nature,
      pricing_mode: r.unit_mode,
      group_lowest: r.group_lowest,
      unit_code: r.unit_code,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      supplier_type: r.supplier_type,
    });
    out.set(r.item_id, entry);
  }
  for (const v of out.values()) v.is_multi_group = v.groups.length > 1;
  return out;
}
