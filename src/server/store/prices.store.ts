/**
 * 价格数据访问（原生 SQL）。
 *
 * 为什么必须原生 SQL 而不是 ORM：`prices.unit_mode` 是 GENERATED 列（读得出、写不得），
 * 而区间命中、阶梯选档、跨单位归一都是 SQL 才写得清的东西（见 db.ts 头注释）。
 */
import type { PoolClient, QueryResultRow } from 'pg';
import { pool, q } from '../db';
import { derivePriceState } from '@/domain/price-resolve';

export interface PriceRow extends QueryResultRow {
  id: string;
  item_id: string;
  supplier_id: string;
  unit_code: string;
  base_unit_qty: string | null;
  unit_price: string;
  currency: string;
  tax_included: boolean;
  pricing_nature: string;
  tax_rate: string | null;
  moq: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  unit_mode: string | null;
  source_note: string | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  item_name: string;
  item_type: string;
  item_spec: string | null;
  item_base_unit_code: string;
  base_unit_name: string;
  supplier_name: string;
  supplier_type: string;
  default_lead_time_days: number | null;
}

export const PRICE_SELECT = `
SELECT p.id, p.item_id, p.supplier_id, p.unit_code, p.base_unit_qty, p.unit_price, p.currency,
       p.tax_included, p.pricing_nature, p.tax_rate, p.moq, p.effective_from, p.effective_to,
       p.status, p.unit_mode, p.source_note, p.last_used_at, p.created_at, p.updated_at, p.created_by,
       i.name AS item_name, i.item_type, i.spec AS item_spec, i.base_unit_code AS item_base_unit_code,
       bu.name_zh AS base_unit_name,
       s.name AS supplier_name, s.type AS supplier_type, s.default_lead_time_days
FROM prices p
JOIN items i     ON i.id = p.item_id
JOIN units bu    ON bu.code = i.base_unit_code
JOIN suppliers s ON s.id = p.supplier_id`;

/** 事务内外通用查询：传 client 就必须用它（用 pool 会跑到另一条连接上，事务白开） */
export async function run<T extends QueryResultRow>(
  c: PoolClient | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = c ? await c.query<T>(sql, params as never[]) : await pool.query<T>(sql, params as never[]);
  return r.rows;
}

export interface TierOut {
  price_id: string;
  min_qty: string;
  unit_price: string;
}

export async function tiersByPriceIds(
  ids: string[],
  c: PoolClient | null = null,
): Promise<Map<string, TierOut[]>> {
  const map = new Map<string, TierOut[]>();
  if (ids.length === 0) return map;
  const rows = await run<TierOut>(
    c,
    `SELECT price_id, min_qty, unit_price FROM price_tiers
      WHERE price_id = ANY($1::uuid[]) ORDER BY min_qty`,
    [ids],
  );
  for (const r of rows) {
    const list = map.get(r.price_id) ?? [];
    list.push(r);
    map.set(r.price_id, list);
  }
  return map;
}

export interface PriceFilters {
  itemId?: string | null;
  supplierId?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  offset: number;
  orderBy?: string;
}

function whereOf(f: PriceFilters): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    parts.push(clause(params.length));
  };
  if (f.itemId) add((n) => `p.item_id = $${n}`, f.itemId);
  if (f.supplierId) add((n) => `p.supplier_id = $${n}`, f.supplierId);
  if (f.status) add((n) => `p.status = $${n}`, f.status);
  // from/to 是「生效区间与查询区间有交叠」，不是简单的 effective_from >= from
  if (f.from) add((n) => `(p.effective_to IS NULL OR p.effective_to >= $${n})`, f.from);
  if (f.to) add((n) => `p.effective_from <= $${n}`, f.to);
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export async function listPrices(f: PriceFilters): Promise<{ rows: PriceRow[]; total: number }> {
  const w = whereOf(f);
  const totalRows = await q<{ n: string }>(`SELECT count(*)::text AS n FROM prices p ${w.sql}`, w.params);
  const rows = await q<PriceRow>(
    `${PRICE_SELECT} ${w.sql} ORDER BY ${f.orderBy ?? 'p.effective_from DESC, s.name'}
     LIMIT ${f.limit} OFFSET ${f.offset}`,
    w.params,
  );
  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function getPriceRow(id: string, c: PoolClient | null = null): Promise<PriceRow | null> {
  const rows = await run<PriceRow>(c, `${PRICE_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface PriceDTO {
  id: string;
  item_id: string;
  item_type: string;
  item_name: string;
  item_spec: string | null;
  base_unit_code: string;
  base_unit_name: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  unit_code: string;
  base_unit_qty: string | null;
  pricing_nature: string;
  unit_mode: string | null;
  unit_price: string;
  currency: string;
  tax_included: boolean;
  tax_rate: string | null;
  moq: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  effective_state: string;
  staleness_days: number;
  last_used_at: string | null;
  source_note: string | null;
  tiers: Array<{ min_qty: string; unit_price: string; max_qty: string | null }>;
  attachments?: Array<Record<string, unknown>>;
  created_by: string | null;
  last_modified_by: string | null;
  created_at: string;
  updated_at: string;
}

export function toPriceDTO(
  row: PriceRow,
  tiers: TierOut[],
  staleDaysThreshold: number,
  today: string,
): PriceDTO {
  const state = derivePriceState({
    status: row.status as 'active' | 'superseded' | 'archived',
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    onDate: today,
    staleDaysThreshold,
  });
  const sorted = [...tiers].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
  return {
    id: row.id,
    item_id: row.item_id,
    item_type: row.item_type,
    item_name: row.item_name,
    item_spec: row.item_spec,
    base_unit_code: row.item_base_unit_code,
    base_unit_name: row.base_unit_name,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    supplier_type: row.supplier_type,
    unit_code: row.unit_code,
    base_unit_qty: row.base_unit_qty,
    pricing_nature: row.pricing_nature,
    unit_mode: row.unit_mode,
    unit_price: row.unit_price,
    currency: row.currency,
    tax_included: row.tax_included,
    tax_rate: row.tax_rate,
    moq: row.moq,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    status: row.status,
    effective_state: state.state,
    staleness_days: state.stalenessDays,
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
    source_note: row.source_note,
    tiers: sorted.map((t, i) => {
      const next = sorted[i + 1];
      return {
        min_qty: t.min_qty,
        unit_price: t.unit_price,
        max_qty: next ? String(Number(next.min_qty) - 1) : null,
      };
    }),
    created_by: row.created_by,
    last_modified_by: null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
