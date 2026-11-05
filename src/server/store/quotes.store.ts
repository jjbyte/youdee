/**
 * 报价单数据访问 + 金额重算（唯一写库入口）。
 *
 * 金额只有一份实现：domain/quote-calc.calcQuote。这里做的事是
 * 「读行 → 喂给 calcQuote → 把行金额与整单合计写回」。
 *
 * 为什么行金额也要写回：quote_items 上有三条恒等式 CHECK
 * （line_price = round(qty×sale,2) 等），数据库会拒收凑不上的行；
 * 更重要的是历史单必须自洽 —— 一年后打开它，金额不能依赖"当时的目标毛利率"。
 */
import type { PoolClient, QueryResultRow } from 'pg';
import { pool, q } from '../db';
import { calcQuote, type CalcLineInput, type CalcQuoteResult } from '@/domain/quote-calc';
import { AppError } from '../http';
import { ymKey } from '../db';

export interface QuoteRow extends QueryResultRow {
  id: string;
  quote_no: string;
  version: number;
  derived_from_quote_id: string | null;
  customer_name: string;
  event_name: string;
  event_date: string | null;
  valid_until: string;
  status: string;
  project_type: string | null;
  currency: string;
  target_margin_rate: string | null;
  discount_amount: string;
  total_cost: string;
  total_price: string;
  total_profit: string;
  margin_rate: string;
  min_line_margin: string | null;
  tax_statement: string;
  note: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  issued_at: Date | null;
  deleted_at: Date | null;
  created_by_name?: string | null;
  created_by_phone?: string | null;
  item_count?: number;
}

export interface QuoteItemRow extends QueryResultRow {
  id: string;
  quote_id: string;
  sort_order: number;
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
  line_cost: string;
  line_price: string;
  line_profit: string;
  line_margin: string;
  cost_source: string;
  price_missing: boolean;
  reference_lowest_price: string | null;
  reference_lowest_supplier_id: string | null;
  tax_included: boolean;
  item_id: string | null;
  price_id: string | null;
  supplier_id: string | null;
  is_visible_to_customer: boolean;
  note: string | null;
  created_at: Date;
}

export async function getQuoteRow(id: string, c: PoolClient | null = null): Promise<QuoteRow | null> {
  const runner = c ?? pool;
  const r = await runner.query<QuoteRow>(
    `SELECT q.*, u.name AS created_by_name, u.phone AS created_by_phone,
            (SELECT count(*) FROM quote_items qi WHERE qi.quote_id = q.id)::int AS item_count
       FROM quotes q LEFT JOIN users u ON u.id = q.created_by
      WHERE q.id = $1 AND q.deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listQuoteItemRows(quoteId: string, c: PoolClient | null = null): Promise<QuoteItemRow[]> {
  const runner = c ?? pool;
  const r = await runner.query<QuoteItemRow>(
    'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, created_at',
    [quoteId],
  );
  return r.rows;
}

export function toCalcLine(row: QuoteItemRow): CalcLineInput {
  return {
    qty: row.qty,
    costUnitPrice: row.cost_unit_price,
    saleUnitPrice: row.sale_unit_price,
    costSource: row.cost_source as 'price_book' | 'manual',
    referenceLowestPrice: row.reference_lowest_price,
    isVisibleToCustomer: row.is_visible_to_customer,
  };
}

function marginText(v: number | null | undefined, fallback = '0'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return fallback;
  return v.toFixed(4);
}

export interface RecalcResult {
  totals: CalcQuoteResult;
  /** 库里原值与重算值不一致的行（说明某处写入绕过了 service 层），不静默修复只说清 */
  drift: string[];
}

/**
 * 重算并写回。**事务内调用时必须传 client**。
 * 三处共用：recalculate、issue、切口径落库；试算只调 calcQuote 不写库。
 */
export async function recalcAndPersist(c: PoolClient, quoteId: string): Promise<RecalcResult> {
  const quote = await getQuoteRow(quoteId, c);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  const items = await listQuoteItemRows(quoteId, c);
  const totals = calcQuote({ lines: items.map(toCalcLine), discountAmount: quote.discount_amount });

  const drift: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const row = items[i]!;
    const calc = totals.lineResults[i]!;
    if (
      row.line_cost !== calc.lineCost
      || row.line_price !== calc.linePrice
      || row.line_profit !== calc.lineProfit
    ) {
      drift.push(
        `第 ${i + 1} 行「${row.item_name_snapshot}」库内金额与重算不一致（库 ${row.line_price} / 算 ${calc.linePrice}），已按重算值修正`,
      );
    }
    await c.query(
      `UPDATE quote_items
          SET line_cost = $2, line_price = $3, line_profit = $4, line_margin = $5
        WHERE id = $1`,
      [row.id, calc.lineCost, calc.linePrice, calc.lineProfit, marginText(calc.lineMargin)],
    );
  }

  await c.query(
    `UPDATE quotes
        SET total_cost = $2, total_price = $3, total_profit = $4,
            margin_rate = $5, min_line_margin = $6, updated_at = now()
      WHERE id = $1`,
    [
      quoteId,
      totals.totalCost,
      totals.totalPrice,
      totals.totalProfit,
      marginText(totals.marginRate),
      totals.minLineMargin === null ? null : marginText(totals.minLineMargin),
    ],
  );
  return { totals, drift };
}

export interface TotalsDTO {
  total_cost: string;
  total_price: string;
  discount_amount: string;
  total_profit: string;
  margin_rate: string;
  min_line_margin: string | null;
}

export function totalsDto(quote: QuoteRow): TotalsDTO {
  return {
    total_cost: quote.total_cost,
    total_price: quote.total_price,
    discount_amount: quote.discount_amount,
    total_profit: quote.total_profit,
    margin_rate: quote.margin_rate,
    min_line_margin: quote.min_line_margin,
  };
}

export function quoteItemDto(row: QuoteItemRow) {
  return {
    id: row.id,
    quote_id: row.quote_id,
    line_kind: row.line_kind,
    pricing_nature: row.pricing_nature,
    sort_order: row.sort_order,
    item_name_snapshot: row.item_name_snapshot,
    spec_snapshot: row.spec_snapshot,
    category_snapshot: row.category_snapshot,
    unit_snapshot: row.unit_snapshot,
    supplier_name_snapshot: row.supplier_name_snapshot,
    qty: row.qty,
    cost_unit_price: row.cost_unit_price,
    sale_unit_price: row.sale_unit_price,
    line_cost: row.line_cost,
    line_price: row.line_price,
    line_profit: row.line_profit,
    line_margin: row.line_margin,
    cost_source: row.cost_source,
    price_missing: row.price_missing,
    reference_lowest_price: row.reference_lowest_price,
    reference_lowest_supplier_id: row.reference_lowest_supplier_id,
    tax_included: row.tax_included,
    item_id: row.item_id,
    price_id: row.price_id,
    supplier_id: row.supplier_id,
    is_visible_to_customer: row.is_visible_to_customer,
    remark: row.note,
    created_at: row.created_at.toISOString(),
  };
}

/** 单号：counters 原子自增（并发下不会撞号，UNIQUE(quote_no, version) 再兜一层） */
export async function nextQuoteNo(c: PoolClient, prefix: string): Promise<string> {
  const key = `quote_no:${ymKey()}`;
  const r = await c.query<{ value: number }>(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [key],
  );
  const value = r.rows[0]!.value;
  return `${prefix}-${ymKey()}-${String(value).padStart(3, '0')}`;
}

export async function countQuotes(): Promise<number> {
  const rows = await q<{ n: string }>('SELECT count(*)::text AS n FROM quotes WHERE deleted_at IS NULL');
  return Number(rows[0]?.n ?? 0);
}
