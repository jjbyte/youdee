/**
 * 供应商主数据。
 *
 * 有价格记录的供应商不允许删除（40904）——历史报价单里的供应商名必须还能解析出来，
 * 想"不看见它"应该用 is_active=false。
 */
import { q, one } from '../db';
import { AppError } from '../http';
import { SUPPLIER_TYPES } from '@/domain/units';
import {
  INVOICE_KEYS,
  INVOICE_LABELS,
  normalizeInvoiceField,
  type InvoiceInfo,
  type InvoiceKey,
} from '@/domain/invoice-info';

// ── 供应商 ──────────────────────────────────────────────────

export interface SupplierInput extends Partial<InvoiceInfo> {
  name: string;
  type: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  shop_url?: string | null;
  region?: string | null;
  default_lead_time_days?: number | null;
  note?: string | null;
  is_active?: boolean;
}

interface SupplierRow extends InvoiceInfo {
  id: string;
  name: string;
  type: string;
  contact_name: string | null;
  contact_phone: string | null;
  shop_url: string | null;
  region: string | null;
  default_lead_time_days: number | null;
  note: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  /** 只有列表查询带（一次算好，别让前端逐行再请求）；详情走 getSupplier 自己的统计 */
  price_count?: string | null;
}

function supplierDto(r: SupplierRow) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    contact_name: r.contact_name,
    contact_phone: r.contact_phone,
    shop_url: r.shop_url,
    region: r.region,
    default_lead_time_days: r.default_lead_time_days,
    note: r.note,
    tax_no: r.tax_no,
    company_address: r.company_address,
    company_phone: r.company_phone,
    bank_name: r.bank_name,
    bank_account: r.bank_account,
    is_active: r.is_active,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    // 列表里的「报价数」列靠这个。以前 SELECT * 不带统计，前端又用 `?? 0` 兜底，
    // 于是每一家都显示 0 —— 数字是错的，比空白更糟：看起来像"这家没报过价"。
    price_count: r.price_count == null ? undefined : Number(r.price_count),
  };
}

/**
 * 开票信息：逐个字段规范化，有错就报**第一条**并说清是哪一格。
 *
 * 为什么不一次性把五条错都返回：界面是逐格校验的（输入时就提示），
 * 服务端这一层只是兜底，一次说一条足够；返回五条反而要求界面再做一个错误列表。
 */
function normalizeInvoice(input: Partial<InvoiceInfo>): Partial<InvoiceInfo> {
  const out: Partial<InvoiceInfo> = {};
  for (const key of INVOICE_KEYS) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (raw === null) {
      out[key] = null;
      continue;
    }
    const res = normalizeInvoiceField(key as InvoiceKey, raw);
    if (res.error) {
      throw new AppError(40001, `${INVOICE_LABELS[key]}：${res.error}`, 400, { field: key });
    }
    out[key] = res.value;
  }
  return out;
}

export interface SupplierListQuery {
  q: string | null;
  type: string | null;
  isActive: boolean | null;
  orderBy: string;
  limit: number;
  offset: number;
}

export async function listSuppliers(query: SupplierListQuery) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };
  if (query.q) add((n) => `name ILIKE $${n}`, `%${query.q!.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (query.type) add((n) => `type = $${n}`, query.type);
  if (query.isActive !== null) add((n) => `is_active = $${n}`, query.isActive);
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const total = await q<{ n: string }>(`SELECT count(*)::text AS n FROM suppliers ${where}`, params);
  const rows = await q<SupplierRow>(
    `SELECT s.*, (SELECT count(*)::text FROM prices p WHERE p.supplier_id = s.id) AS price_count
       FROM suppliers s ${where}
      ORDER BY ${query.orderBy} LIMIT ${query.limit} OFFSET ${query.offset}`,
    params,
  );
  return {
    items: rows.map(supplierDto),
    total: Number(total[0]?.n ?? 0),
    page: Math.floor(query.offset / query.limit) + 1,
    limit: query.limit,
    hasMore: query.offset + rows.length < Number(total[0]?.n ?? 0),
  };
}

export async function getSupplier(id: string) {
  const row = await one<SupplierRow>('SELECT * FROM suppliers WHERE id = $1', [id]);
  if (!row) throw new AppError(40401, '这家供应商不存在。', 404);
  const stats = await one<{ price_count: string; item_count: string }>(
    `SELECT count(*)::text AS price_count, count(DISTINCT item_id)::text AS item_count
       FROM prices WHERE supplier_id = $1`,
    [id],
  );
  return { ...supplierDto(row), price_count: Number(stats?.price_count ?? 0), item_count: Number(stats?.item_count ?? 0) };
}

export async function createSupplier(input: SupplierInput) {
  if (!SUPPLIER_TYPES.includes(input.type as never)) {
    throw new AppError(40001, '供应商类型不在允许值内。', 400, { field: 'type' });
  }
  const inv = normalizeInvoice(input);
  const rows = await q<SupplierRow>(
    `INSERT INTO suppliers (name, type, contact_name, contact_phone, shop_url, region,
                            default_lead_time_days, note, is_active,
                            tax_no, company_address, company_phone, bank_name, bank_account)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      input.name,
      input.type,
      input.contact_name ?? null,
      input.contact_phone ?? null,
      input.shop_url ?? null,
      input.region ?? null,
      input.default_lead_time_days ?? null,
      input.note ?? null,
      input.is_active ?? true,
      inv.tax_no ?? null,
      inv.company_address ?? null,
      inv.company_phone ?? null,
      inv.bank_name ?? null,
      inv.bank_account ?? null,
    ],
  );
  return supplierDto(rows[0]!);
}

export async function patchSupplier(id: string, input: Partial<SupplierInput>) {
  const current = await one<SupplierRow>('SELECT * FROM suppliers WHERE id = $1', [id]);
  if (!current) throw new AppError(40401, '这家供应商不存在。', 404);
  if (input.type && !SUPPLIER_TYPES.includes(input.type as never)) {
    throw new AppError(40001, '供应商类型不在允许值内。', 400, { field: 'type' });
  }
  const inv = normalizeInvoice(input);
  const rows = await q<SupplierRow>(
    `UPDATE suppliers SET name=$2, type=$3, contact_name=$4, contact_phone=$5, shop_url=$6, region=$7,
            default_lead_time_days=$8, note=$9, is_active=$10,
            tax_no=$11, company_address=$12, company_phone=$13, bank_name=$14, bank_account=$15,
            updated_at=now()
      WHERE id=$1 RETURNING *`,
    [
      id,
      input.name ?? current.name,
      input.type ?? current.type,
      input.contact_name !== undefined ? input.contact_name : current.contact_name,
      input.contact_phone !== undefined ? input.contact_phone : current.contact_phone,
      input.shop_url !== undefined ? input.shop_url : current.shop_url,
      input.region !== undefined ? input.region : current.region,
      input.default_lead_time_days !== undefined ? input.default_lead_time_days : current.default_lead_time_days,
      input.note !== undefined ? input.note : current.note,
      input.is_active !== undefined ? input.is_active : current.is_active,
      // 三态：undefined = 这一格没提交（不动）；null = 清空；有值 = 写规范化后的值
      inv.tax_no !== undefined ? inv.tax_no : current.tax_no,
      inv.company_address !== undefined ? inv.company_address : current.company_address,
      inv.company_phone !== undefined ? inv.company_phone : current.company_phone,
      inv.bank_name !== undefined ? inv.bank_name : current.bank_name,
      inv.bank_account !== undefined ? inv.bank_account : current.bank_account,
    ],
  );
  return supplierDto(rows[0]!);
}

export async function deleteSupplier(id: string) {
  const current = await one<{ id: string; name: string }>('SELECT id, name FROM suppliers WHERE id = $1', [id]);
  if (!current) throw new AppError(40401, '这家供应商不存在。', 404);
  const used = await one<{ n: string; items: string }>(
    'SELECT count(*)::text AS n, count(DISTINCT item_id)::text AS items FROM prices WHERE supplier_id = $1',
    [id],
  );
  const priceCount = Number(used?.n ?? 0);
  /**
   * 有价就**拒绝**，不像物料那样连带删。
   *
   * 差别在爆炸半径：删一个物料只带走它自己那几家的价；删一家供应商会一次性带走
   * 十几个物料上的价——那些物料的其他供应商报价还在，于是比价表里"最便宜的一家"
   * 会静默换人，而没人知道原因。这条拒绝不是保守，是唯一能解释清楚的做法。
   */
  if (priceCount > 0) {
    throw new AppError(
      40904,
      `这家供应商还有 ${priceCount} 条价格（涉及 ${used?.items ?? 0} 个物料），删掉会连带影响这些物料的比价。先删掉它的价，或者用「作废」。`,
      409,
      { detail: { price_count: priceCount, item_count: Number(used?.items ?? 0) } },
    );
  }
  await q('DELETE FROM suppliers WHERE id = $1', [id]);
  return { deleted: true, name: current.name };
}

/** 作废 / 恢复：只有 is_active 一位之差。作废后不再出现在录价与比价的可选供应商里 */
export async function setSupplierActive(id: string, active: boolean) {
  const row = await one<{ id: string; name: string }>('SELECT id, name FROM suppliers WHERE id = $1', [id]);
  if (!row) throw new AppError(40401, '这家供应商不存在。', 404);
  await q('UPDATE suppliers SET is_active = $2, updated_at = now() WHERE id = $1', [id, active]);
  return { id: row.id, name: row.name, is_active: active };
}
