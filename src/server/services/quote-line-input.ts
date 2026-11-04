/**
 * 报价行的输入类型与两个"取快照用"的窄查询。
 *
 * 单独成文件而不是塞进 quote-line.service：这三个页面（录单、批量导入、改行）
 * 共用同一套字段语义，类型定义只该有一处；而"从哪个表取主体/价格的名字"
 * 与"怎么算这行的成本"是两件事，改一个时不该碰到另一个。
 */
import { q } from '../db';

export interface QuoteItemInput {
  line_kind: string;
  pricing_nature?: string | null;
  sort_order?: number;
  item_name_snapshot?: string;
  spec_snapshot?: string | null;
  category_snapshot?: string | null;
  unit_snapshot?: string;
  qty: string;
  cost_unit_price?: string | null;
  cost_source: string;
  reference_lowest_price?: string | null;
  reference_lowest_supplier_id?: string | null;
  sale_unit_price?: string | null;
  item_id?: string | null;
  supplier_id?: string | null;
  supplier_name_snapshot?: string | null;
  price_id?: string | null;
  is_visible_to_customer?: boolean;
  remark?: string | null;
}

/** 一行落库前的完整快照（quote_items 的所有 *_snapshot 与金额列都在这里定死） */
export interface RowDraft {
  line_kind: string;
  pricing_nature: string | null;
  item_name_snapshot: string;
  spec_snapshot: string | null;
  category_snapshot: string | null;
  unit_snapshot: string;
  supplier_name_snapshot: string | null;
  qty: string;
  cost_unit_price: string;
  sale_unit_price: string;
  cost_source: 'price_book' | 'manual';
  price_missing: boolean;
  reference_lowest_price: string | null;
  reference_lowest_supplier_id: string | null;
  tax_included: boolean;
  item_id: string | null;
  price_id: string | null;
  supplier_id: string | null;
  is_visible_to_customer: boolean;
  note: string | null;
}

export interface PriceBrief {
  id: string;
  item_id: string;
  supplier_id: string;
  supplier_name: string;
  pricing_nature: string;
  unit_code: string;
  unit_mode: string | null;
  tax_included: boolean;
}

export interface ItemBriefRow {
  id: string;
  name: string;
  spec: string | null;
  base_unit_name: string;
  category_name: string | null;
}

export async function loadItemBrief(itemId: string): Promise<ItemBriefRow | null> {
  const rows = await q<ItemBriefRow>(
    `SELECT i.id, i.name, i.spec, u.name_zh AS base_unit_name, c.name AS category_name
       FROM items i JOIN units u ON u.code = i.base_unit_code
       JOIN categories c ON c.id = i.category_id
      WHERE i.id = $1`,
    [itemId],
  );
  return rows[0] ?? null;
}

export async function loadPriceBrief(priceId: string): Promise<PriceBrief | null> {
  const rows = await q<PriceBrief>(
    `SELECT p.id, p.item_id, p.supplier_id, s.name AS supplier_name, p.pricing_nature,
            p.unit_code, p.unit_mode, p.tax_included
       FROM prices p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1`,
    [priceId],
  );
  return rows[0] ?? null;
}
