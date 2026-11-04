/**
 * 报价行请求体解析。
 *
 * 单行追加、批量追加、改行三处共用一个解析器：字段名校验写三遍，
 * 迟早出现"批量接口认 remark、单行接口不认"这种只有用户才发现的差异。
 */
import { AppError, optDate, optDecimal, optStr, optStr as optStrRaw, reqDecimal, reqStr, reqUuid } from './http';
import type { QuoteItemInput } from './services/quote-line-input';

type Body = Record<string, unknown>;

function maybeUuid(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return reqUuid(v, field);
}

export function parseQuoteItemCreate(b: Body): QuoteItemInput {
  const costSource = reqStr(b.cost_source, '成本来源', 20);
  if (costSource !== 'price_book' && costSource !== 'manual') {
    throw new AppError(40001, '成本来源只能是 price_book（价格库）或 manual（手填）。', 400, {
      field: 'cost_source',
    });
  }
  return {
    line_kind: reqStr(b.line_kind, '行类型', 20),
    qty: reqDecimal(b.qty, '数量'),
    cost_source: costSource,
    item_name_snapshot: optStr(b.item_name_snapshot, 80) ?? undefined,
    unit_snapshot: optStr(b.unit_snapshot, 20) ?? undefined,
    cost_unit_price: optDecimal(b.cost_unit_price, '成本单价'),
    sale_unit_price: optDecimal(b.sale_unit_price, '对客单价'),
    pricing_nature: optStr(b.pricing_nature, 20),
    sort_order: b.sort_order === undefined ? undefined : Number(b.sort_order),
    spec_snapshot: optStr(b.spec_snapshot, 200),
    category_snapshot: optStr(b.category_snapshot, 30),
    item_id: maybeUuid(b.item_id, 'item_id') ?? null,
    supplier_id: maybeUuid(b.supplier_id, 'supplier_id') ?? null,
    price_id: maybeUuid(b.price_id, 'price_id') ?? null,
    supplier_name_snapshot: optStr(b.supplier_name_snapshot, 80),
    reference_lowest_price: optDecimal(b.reference_lowest_price, '参考最低价'),
    reference_lowest_supplier_id: maybeUuid(b.reference_lowest_supplier_id, 'reference_lowest_supplier_id') ?? null,
    is_visible_to_customer: b.is_visible_to_customer === undefined ? undefined : Boolean(b.is_visible_to_customer),
    remark: optStr(b.remark, 300),
  };
}

/** 改行：只有真传了的字段才进 update，避免"没传的字段被静默清成 null" */
export function parseQuoteItemPatch(b: Body): Partial<QuoteItemInput> {
  const out: Partial<QuoteItemInput> = {};
  if (b.line_kind !== undefined) out.line_kind = reqStr(b.line_kind, '行类型', 20);
  if (b.qty !== undefined) out.qty = reqDecimal(b.qty, '数量');
  if (b.cost_source !== undefined) out.cost_source = reqStr(b.cost_source, '成本来源', 20);
  if (b.cost_unit_price !== undefined) out.cost_unit_price = optDecimal(b.cost_unit_price, '成本单价');
  if (b.sale_unit_price !== undefined) out.sale_unit_price = optDecimal(b.sale_unit_price, '对客单价');
  if (b.pricing_nature !== undefined) out.pricing_nature = optStr(b.pricing_nature, 20);
  if (b.item_name_snapshot !== undefined) out.item_name_snapshot = optStr(b.item_name_snapshot, 80) ?? '';
  if (b.unit_snapshot !== undefined) out.unit_snapshot = optStr(b.unit_snapshot, 20) ?? '';
  if (b.spec_snapshot !== undefined) out.spec_snapshot = optStr(b.spec_snapshot, 200);
  if (b.category_snapshot !== undefined) out.category_snapshot = optStrRaw(b.category_snapshot, 30);
  if (b.supplier_name_snapshot !== undefined) out.supplier_name_snapshot = optStr(b.supplier_name_snapshot, 80);
  if (b.item_id !== undefined) out.item_id = maybeUuid(b.item_id, 'item_id') ?? null;
  if (b.supplier_id !== undefined) out.supplier_id = maybeUuid(b.supplier_id, 'supplier_id') ?? null;
  if (b.price_id !== undefined) out.price_id = maybeUuid(b.price_id, 'price_id') ?? null;
  if (b.reference_lowest_price !== undefined) {
    out.reference_lowest_price = optDecimal(b.reference_lowest_price, '参考最低价');
  }
  if (b.reference_lowest_supplier_id !== undefined) {
    out.reference_lowest_supplier_id = maybeUuid(b.reference_lowest_supplier_id, 'reference_lowest_supplier_id') ?? null;
  }
  if (b.is_visible_to_customer !== undefined) out.is_visible_to_customer = Boolean(b.is_visible_to_customer);
  if (b.remark !== undefined) out.remark = optStr(b.remark, 300);
  void optDate;
  return out;
}
