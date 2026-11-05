/**
 * 报价单：建单 / 改抬头 / 列表 / 详情 / 删除。
 *
 * 口径声明（tax_statement）在创建时**从 app_settings 复制**，之后两者独立：
 * 设置改了不会回头改历史单 —— 报价单是快照，不是视图。
 */
import { AppError } from '../http';
import { q, today, tx } from '../db';
import { isExpired, canDelete } from '@/domain/quote-status';
import { canDeleteRecord } from '@/domain/permissions';
import type { CurrentUser } from '../auth/session';
import {
  getQuoteRow,
  listQuoteItemRows,
  nextQuoteNo,
  quoteItemDto,
  recalcAndPersist,
  totalsDto,
  type QuoteRow,
} from '../store/quotes.store';
import {
  defaultMarginRateForType,
  defaultTaxBasis,
  marginThresholds,
  marginWarnRate,
  quoteNoPrefix,
  type MarginThresholdRow,
} from '../store/settings.store';
import { patchQuoteTaxBasis } from './tax.service';
import { addDays } from '../dates';
import { paginated, type PageQuery } from '../params';

export interface QuoteWarnInfo {
  used: number;
  source: 'project_type' | 'global_default';
}

export async function warnRateMap(): Promise<{
  byType: Map<string, number>;
  global: QuoteWarnInfo;
}> {
  const rows: MarginThresholdRow[] = await marginThresholds();
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.project_type, Number(r.warn_rate));
  const warn = await marginWarnRate(null);
  return { byType, global: { used: warn.rate, source: warn.source } };
}

function warnOf(
  map: { byType: Map<string, number>; global: QuoteWarnInfo },
  projectType: string | null,
): QuoteWarnInfo {
  if (projectType && map.byType.has(projectType)) {
    return { used: map.byType.get(projectType)!, source: 'project_type' };
  }
  return map.global;
}

export interface QuoteBaseDTO {
  id: string;
  quote_no: string;
  version: number;
  customer_name: string;
  event_name: string;
  event_date: string | null;
  project_type: string | null;
  warn_rate_used: string | null;
  warn_rate_source: 'project_type' | 'global_default';
  valid_until: string;
  status: string;
  is_expired: boolean;
  item_count: number;
  created_by_name: string | null;
  /** 报价人电话：抬头那行给客户看，缺失时抬头只显示姓名 */
  created_by_phone: string | null;
  created_at: string;
  issued_at: string | null;
  total_cost: string;
  total_price: string;
  discount_amount: string;
  total_profit: string;
  margin_rate: string;
  min_line_margin: string | null;
}

export function toQuoteBase(
  row: QuoteRow,
  map: { byType: Map<string, number>; global: QuoteWarnInfo },
  todayStr: string,
): QuoteBaseDTO {
  const warn = warnOf(map, row.project_type);
  return {
    id: row.id,
    quote_no: row.quote_no,
    version: row.version,
    customer_name: row.customer_name,
    event_name: row.event_name,
    event_date: row.event_date,
    project_type: row.project_type,
    warn_rate_used: warn.used.toFixed(4),
    warn_rate_source: warn.source,
    valid_until: row.valid_until,
    status: row.status,
    is_expired: isExpired(row.status as 'draft' | 'issued' | 'void', row.valid_until, todayStr),
    item_count: Number(row.item_count ?? 0),
    created_by_name: row.created_by_name ?? null,
    created_by_phone: row.created_by_phone ?? null,
    created_at: row.created_at.toISOString(),
    issued_at: row.issued_at ? row.issued_at.toISOString() : null,
    ...totalsDto(row),
  };
}

export async function quoteDetail(id: string) {
  const row = await getQuoteRow(id);
  if (!row) throw new AppError(40401, '这张报价单不存在。', 404);
  const items = await listQuoteItemRows(id);
  const map = await warnRateMap();
  return {
    ...toQuoteBase(row, map, today()),
    derived_from_quote_id: row.derived_from_quote_id,
    target_margin_rate: row.target_margin_rate,
    currency: row.currency,
    tax_statement: row.tax_statement,
    note: row.note,
    updated_at: row.updated_at.toISOString(),
    items: items.map(quoteItemDto),
  };
}

export interface QuoteListQuery {
  q: string | null;
  status: string | null;
  projectType: string | null;
  from: string | null;
  to: string | null;
  page: PageQuery;
  orderBy: string;
}

export async function listQuotes(query: QuoteListQuery) {
  const parts: string[] = ['q.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };
  if (query.status) add((n) => `q.status = $${n}`, query.status);
  if (query.projectType) add((n) => `q.project_type = $${n}`, query.projectType);
  if (query.from) add((n) => `q.created_at::date >= $${n}::date`, query.from);
  if (query.to) add((n) => `q.created_at::date <= $${n}::date`, query.to);
  if (query.q) {
    add(
      (n) => `(q.customer_name ILIKE $${n} OR q.event_name ILIKE $${n} OR q.quote_no ILIKE $${n})`,
      `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
    );
  }
  const where = `WHERE ${parts.join(' AND ')}`;
  const totalRows = await q<{ n: string }>(`SELECT count(*)::text AS n FROM quotes q ${where}`, params);
  const rows = await q<QuoteRow>(
    `SELECT q.*, u.name AS created_by_name,
            (SELECT count(*) FROM quote_items qi WHERE qi.quote_id = q.id)::int AS item_count
       FROM quotes q LEFT JOIN users u ON u.id = q.created_by
       ${where}
      ORDER BY ${query.orderBy}
      LIMIT ${query.page.limit} OFFSET ${query.page.offset}`,
    params,
  );
  const map = await warnRateMap();
  const todayStr = today();
  return paginated(
    rows.map((r) => toQuoteBase(r, map, todayStr)),
    Number(totalRows[0]?.n ?? 0),
    query.page,
  );
}

export interface CreateQuoteInput {
  customer_name: string;
  event_name: string;
  valid_until: string;
  event_date?: string | null;
  project_type?: string | null;
  target_margin_rate?: string | null;
  discount_amount?: string | null;
  note?: string | null;
}

export async function createQuote(actor: CurrentUser, input: CreateQuoteInput) {
  const todayStr = today();
  if (input.valid_until < todayStr) {
    throw new AppError(42203, '报价有效期早于今天。请把有效期改为今天或之后。', 422, { field: 'valid_until' });
  }
  const prefix = await quoteNoPrefix();
  const taxStatement = await defaultTaxBasis();
  const discount = input.discount_amount ?? '0';
  // 选了类型就用该类型的默认毛利率建单；没配就留空，由报价员自己填
  const marginRate =
    input.target_margin_rate ??
    (input.project_type ? ((await defaultMarginRateForType(input.project_type))?.toFixed(4) ?? null) : null);
  const newId = await tx(async (c) => {
    const quoteNo = await nextQuoteNo(c, prefix);
    const r = await c.query<{ id: string }>(
      `INSERT INTO quotes (quote_no, version, customer_name, event_name, event_date, valid_until, status,
                           project_type, currency, target_margin_rate, discount_amount,
                           total_cost, total_price, total_profit, margin_rate, min_line_margin,
                           tax_statement, note, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, 'draft', $6, 'CNY', $7, $8, 0, 0, 0, 0, NULL, $9, $10, $11)
       RETURNING id`,
      [
        quoteNo,
        input.customer_name,
        input.event_name,
        input.event_date ?? null,
        input.valid_until,
        input.project_type ?? null,
        marginRate,
        discount,
        taxStatement,
        input.note ?? null,
        actor.id,
      ],
    );
    return r.rows[0]!.id;
  });
  return quoteDetail(newId);
}

export interface PatchQuoteInput extends Partial<CreateQuoteInput> {
  tax_statement?: 'inclusive' | 'exclusive';
}

/**
 * 改抬头。`issued` / `void` 态只允许改备注 —— 已发出的单是可对账凭据，
 * 改金额或客户名等于换了一张单，那要走「改版」。
 */
export async function patchQuote(id: string, input: PatchQuoteInput) {
  const row = await getQuoteRow(id);
  if (!row) throw new AppError(40401, '这张报价单不存在。', 404);

  const keys = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  if (row.status !== 'draft') {
    const forbidden = keys.filter((k) => k !== 'note');
    if (forbidden.length > 0) {
      throw new AppError(
        40905,
        `报价单已${row.status === 'issued' ? '发出' : '作废'}，只能改备注。要改内容请用「改版重报」。`,
        409,
        { detail: { forbidden } },
      );
    }
    await q('UPDATE quotes SET note = $2, updated_at = now() WHERE id = $1', [id, input.note ?? row.note]);
    return quoteDetail(id);
  }

  if (input.valid_until && input.valid_until < today()) {
    throw new AppError(42203, '报价有效期早于今天。', 422, { field: 'valid_until' });
  }

  const next = {
    customer_name: input.customer_name ?? row.customer_name,
    event_name: input.event_name ?? row.event_name,
    event_date: input.event_date !== undefined ? input.event_date : row.event_date,
    valid_until: input.valid_until ?? row.valid_until,
    project_type: input.project_type !== undefined ? input.project_type : row.project_type,
    target_margin_rate: input.target_margin_rate !== undefined ? input.target_margin_rate : row.target_margin_rate,
    discount_amount: input.discount_amount ?? row.discount_amount,
    note: input.note !== undefined ? input.note : row.note,
  };

  /**
   * 换项目类型就换默认毛利率——客户原话「选择不同的类型，报价单的毛利率没有同步改变」。
   *
   * 只改单头的目标毛利率，**不碰任何已有行的对客价**：售价是按行算死的快照，
   * 改毛利率要生效得显式点「按毛利率重算」。这条边界必须守住——否则换个类型
   * 就把客户已经看过的那份报价上的每个金额都改了，而界面上没人会注意到。
   *
   * 新类型没配默认毛利率时保持原值不清空：清空等于逼人重填一个金额输入框，
   * 而空白毛利率会让下一次攒单直接失败。
   */
  if (
    input.project_type !== undefined &&
    input.target_margin_rate === undefined &&
    next.project_type !== row.project_type &&
    next.project_type
  ) {
    const typeMargin = await defaultMarginRateForType(next.project_type);
    if (typeMargin !== null) next.target_margin_rate = typeMargin.toFixed(4);
  }

  await tx(async (c) => {
    await c.query(
      `UPDATE quotes SET customer_name=$2, event_name=$3, event_date=$4, valid_until=$5, project_type=$6,
              target_margin_rate=$7, discount_amount=$8, note=$9, updated_at=now()
        WHERE id=$1`,
      [
        id,
        next.customer_name,
        next.event_name,
        next.event_date,
        next.valid_until,
        next.project_type,
        next.target_margin_rate,
        next.discount_amount,
        next.note,
      ],
    );
    // 优惠额变了整单合计就变了，必须重算（金额只有 calcQuote 一份实现）
    await recalcAndPersist(c, id);
  });

  // 切口径是「重跑全部行取价」的动作，单独一条路径，保证提示与落库同一份计划
  if (input.tax_statement && input.tax_statement !== row.tax_statement) {
    await patchQuoteTaxBasis(id, input.tax_statement);
  }
  return quoteDetail(id);
}

export async function deleteQuote(id: string, actor: CurrentUser): Promise<void> {
  const row = await getQuoteRow(id);
  if (!row) throw new AppError(40401, '这张报价单不存在。', 404);
  if (!canDelete(row.status as 'draft' | 'issued' | 'void')) {
    throw new AppError(40905, '这张报价单的状态不允许删除。', 409);
  }
  if (!canDeleteRecord(actor.role)) {
    throw new AppError(40301, '只有管理员能删报价单。你可以用「作废」——作废之后随时能恢复。', 403);
  }
  /**
   * 软删（deleted_at），不是 DELETE。
   *
   * 已发出的单被删掉之后，单号还得能被**查证**：客户拿着一张 2026-QT-0007 找过来问
   * 「这单我们确认过没有」，答案不能因为管理员点过一次删除就变成"查无此单"。
   * 软删让它在列表里消失，但单号、金额、行明细都还在库里。
   */
  await q('UPDATE quotes SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
}
