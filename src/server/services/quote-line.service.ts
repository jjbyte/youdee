/**
 * 报价单明细的增删改与排序（只处理"行"本身，不算钱以外的事）。
 *
 * 所有金额都由服务端在同一处算出后落表（quote-line-draft + domain/quote-calc），
 * 前端传来的金额字段一律忽略。
 */
import { q, tx } from '../db';
import { AppError } from '../http';
import { calcLine } from '@/domain/quote-calc';
import {
  getQuoteRow,
  listQuoteItemRows,
  quoteItemDto,
  recalcAndPersist,
  totalsDto,
  type QuoteItemRow,
  type QuoteRow,
} from '../store/quotes.store';
import { staleDaysThreshold } from '../store/settings.store';
import { buildDraft, insertRow } from './quote-line-draft.service';
import type { QuoteItemInput, RowDraft } from './quote-line-input';

export async function requireDraft(quoteId: string): Promise<QuoteRow> {
  const quote = await getQuoteRow(quoteId);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (quote.status !== 'draft') {
    throw new AppError(40905, '报价单已发出或已作废，明细不可修改。要改请用「改版重报」。', 409);
  }
  return quote;
}

export async function addItems(quoteId: string, inputs: QuoteItemInput[]) {
  if (inputs.length === 0) throw new AppError(40001, '至少要提交一行。', 400);
  if (inputs.length > 100) throw new AppError(40001, '一次最多追加 100 行。', 400);
  const quote = await requireDraft(quoteId);
  const stale = await staleDaysThreshold();
  const drafts: RowDraft[] = [];
  for (const input of inputs) drafts.push(await buildDraft(quote, input, stale));

  const ids = await tx(async (c) => {
    const maxRow = await c.query<{ n: number | null }>(
      'SELECT max(sort_order) AS n FROM quote_items WHERE quote_id = $1',
      [quoteId],
    );
    let sort = Number(maxRow.rows[0]?.n ?? 0);
    const out: string[] = [];
    for (const d of drafts) {
      sort += 1;
      out.push(await insertRow(c, quoteId, d, sort));
    }
    await recalcAndPersist(c, quoteId);
    return out;
  });

  const rows = await q<QuoteItemRow>('SELECT * FROM quote_items WHERE id = ANY($1::uuid[]) ORDER BY sort_order', [ids]);
  const after = await getQuoteRow(quoteId);
  return { items: rows.map(quoteItemDto), item: rows[0] ? quoteItemDto(rows[0]) : null, quote_totals: totalsDto(after!) };
}

export async function updateItem(quoteId: string, itemId: string, input: Partial<QuoteItemInput>) {
  const quote = await requireDraft(quoteId);
  const existing = await q<QuoteItemRow>('SELECT * FROM quote_items WHERE id = $1 AND quote_id = $2', [itemId, quoteId]);
  const current = existing[0];
  if (!current) throw new AppError(40401, '这一行不存在。', 404);

  const stale = await staleDaysThreshold();
  const merged: QuoteItemInput = {
    line_kind: input.line_kind ?? current.line_kind,
    pricing_nature: input.pricing_nature ?? current.pricing_nature,
    item_name_snapshot: input.item_name_snapshot ?? current.item_name_snapshot,
    spec_snapshot: input.spec_snapshot !== undefined ? input.spec_snapshot : current.spec_snapshot,
    category_snapshot: input.category_snapshot !== undefined ? input.category_snapshot : current.category_snapshot,
    unit_snapshot: input.unit_snapshot ?? current.unit_snapshot,
    qty: input.qty ?? current.qty,
    cost_source: input.cost_source ?? current.cost_source,
    cost_unit_price: input.cost_unit_price !== undefined && input.cost_unit_price !== null
      ? input.cost_unit_price
      : current.cost_unit_price,
    sale_unit_price: input.sale_unit_price !== undefined ? input.sale_unit_price : current.sale_unit_price,
    item_id: input.item_id !== undefined ? input.item_id : current.item_id,
    supplier_id: input.supplier_id !== undefined ? input.supplier_id : current.supplier_id,
    supplier_name_snapshot: input.supplier_name_snapshot !== undefined
      ? input.supplier_name_snapshot
      : current.supplier_name_snapshot,
    price_id: input.price_id !== undefined ? input.price_id : current.price_id,
    reference_lowest_price: input.reference_lowest_price !== undefined
      ? input.reference_lowest_price
      : current.reference_lowest_price,
    reference_lowest_supplier_id: input.reference_lowest_supplier_id !== undefined
      ? input.reference_lowest_supplier_id
      : current.reference_lowest_supplier_id,
    is_visible_to_customer: input.is_visible_to_customer ?? current.is_visible_to_customer,
    remark: input.remark !== undefined ? input.remark : current.note,
  };
  const draft = await buildDraft(quote, merged, stale);
  // 手填行改数量时若未重给成本，沿用原成本；否则 buildDraft 已从价格库重取
  const line = calcLine({
    qty: draft.qty,
    costUnitPrice: draft.cost_unit_price,
    saleUnitPrice: draft.sale_unit_price,
    costSource: draft.cost_source,
    referenceLowestPrice: draft.reference_lowest_price,
    isVisibleToCustomer: draft.is_visible_to_customer,
  });

  await tx(async (c) => {
    await c.query(
      `UPDATE quote_items SET
         line_kind=$2, pricing_nature=$3, item_name_snapshot=$4, spec_snapshot=$5, category_snapshot=$6,
         unit_snapshot=$7, supplier_name_snapshot=$8, qty=$9, cost_unit_price=$10, sale_unit_price=$11,
         line_cost=$12, line_price=$13, line_profit=$14, line_margin=$15, cost_source=$16, price_missing=$17,
         reference_lowest_price=$18, reference_lowest_supplier_id=$19, tax_included=$20,
         item_id=$21, price_id=$22, supplier_id=$23, is_visible_to_customer=$24, note=$25
       WHERE id=$1`,
      [
        itemId,
        draft.line_kind,
        draft.pricing_nature,
        draft.item_name_snapshot,
        draft.spec_snapshot,
        draft.category_snapshot,
        draft.unit_snapshot,
        draft.supplier_name_snapshot,
        draft.qty,
        draft.cost_unit_price,
        draft.sale_unit_price,
        line.lineCost,
        line.linePrice,
        line.lineProfit,
        (line.lineMargin ?? 0).toFixed(4),
        draft.cost_source,
        draft.price_missing,
        draft.reference_lowest_price,
        draft.reference_lowest_supplier_id,
        draft.tax_included,
        draft.item_id,
        draft.price_id,
        draft.supplier_id,
        draft.is_visible_to_customer,
        draft.note,
      ],
    );
    await recalcAndPersist(c, quoteId);
  });

  const row = (await q<QuoteItemRow>('SELECT * FROM quote_items WHERE id = $1', [itemId]))[0]!;
  const after = await getQuoteRow(quoteId);
  return { item: quoteItemDto(row), quote_totals: totalsDto(after!) };
}

export async function deleteItem(quoteId: string, itemId: string) {
  await requireDraft(quoteId);
  const out = await tx(async (c) => {
    const r = await c.query('DELETE FROM quote_items WHERE id = $1 AND quote_id = $2', [itemId, quoteId]);
    if (r.rowCount === 0) throw new AppError(40401, '这一行不存在。', 404);
    await recalcAndPersist(c, quoteId);
    return getQuoteRow(quoteId, c);
  });
  return { quote_totals: totalsDto(out!) };
}

export async function reorderItems(quoteId: string, orderedIds: string[]) {
  await requireDraft(quoteId);
  const rows = await listQuoteItemRows(quoteId);
  const existing = new Set(rows.map((r) => r.id));
  if (orderedIds.length !== rows.length || orderedIds.some((id) => !existing.has(id))) {
    throw new AppError(40001, '排序必须覆盖这张单的全部行（不多不少）。', 400, { field: 'ordered_ids' });
  }
  await tx(async (c) => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await c.query('UPDATE quote_items SET sort_order = $2 WHERE id = $1', [orderedIds[i]!, i + 1]);
    }
  });
  const after = await listQuoteItemRows(quoteId);
  return after.map(quoteItemDto);
}
