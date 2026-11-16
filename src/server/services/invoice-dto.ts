/**
 * 发票的 DTO 与行映射（纯数据搬运，不含业务判断）。
 *
 * 单独一个文件是为了守住「单文件 ≤300 行 + 单一职责」：`invoice.service.ts`
 * 负责口径（谁能改、什么状态能流转），这里只负责「pg 行 → 前端能吃的 JSON」。
 *
 * 两条硬规矩：
 *   1) 金额一律**原样字符串**。`db.ts` 已把 numeric(1700) 解析成 string，
 *      这里绝不能 `Number()` —— 一旦转成 JS number，1234567890.12 就开始丢位，
 *      而那是拿去对账的数。
 *   2) `issued_on` 是 date 列，`db.ts` 的类型解析器原样返回 `yyyy-mm-dd`，
 *      **不做时区转换**（转了就出现"3 月 1 日的票在列表里是 2 月 28 日"）。
 */
import type { QueryResultRow } from 'pg';
import {
  DEFAULT_CONTRACT_STATUS,
  isContractStatus,
  type ContractStatus,
} from '@/domain/contract';
import {
  isAmountCheck,
  isInvoiceStatus,
  isInvoiceStatusSource,
  type AmountCheck,
  type InvoiceStatus,
  type InvoiceStatusSource,
} from '@/domain/invoice-record';

/* ── DTO（字段名与 invoice-spec §4.2 逐字对齐）────────────────── */

export interface InvoiceDTO {
  id: string;
  invoice_no: string;
  invoice_code: string;
  status: InvoiceStatus;
  status_source: InvoiceStatusSource;
  invoice_type: string;
  invoice_type_label: string;
  issued_on: string | null;
  buyer_name: string;
  buyer_tax_no: string | null;
  seller_name: string;
  seller_tax_no: string | null;
  amount: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  amount_check: AmountCheck;
  remark: string | null;
  file_count: number;
  contract_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InvoiceSummaryDTO {
  count: number;
  sum_amount: string;
  sum_tax_amount: string;
  sum_total_amount: string;
  missing_amount_count: number;
  /**
   * 命中行里 `status='red'` 的条数。
   *
   * 为什么必须单独给：冲红票的金额是**负数**，用户看到 "合计 8,870" 而列表里有 3 张
   * 红票时，第一反应是"合计算错了"。界面上那句「含冲红 N 张」就是把符号解释掉，
   * 而 N 只有服务端知道（前端按页算会算成"本页有几张"，跨页就对不上）。
   */
  red_count: number;
}

export interface InvoiceFileDTO {
  id: string;
  /** local = 本地磁盘；cos = 云存储（走后端签名跳转） */
  storage: 'local' | 'cos';
  url: string;
  original_name: string;
  mime: string;
  ext: string;
  size_bytes: number;
  created_at: string;
}

/** 详情里「已关联的合同」。soft-deleted 的也返回（界面标灰 + 提示可恢复） */
export interface InvoiceContractDTO {
  id: string;
  contract_no: string | null;
  title: string;
  company_name: string;
  project_name: string | null;
  status: ContractStatus;
  deleted: boolean;
}

export interface InvoiceDetailDTO extends InvoiceDTO {
  files: InvoiceFileDTO[];
  contracts: InvoiceContractDTO[];
}

/* ── 行类型 ───────────────────────────────────────────────── */

export interface InvoiceRow extends QueryResultRow {
  id: string;
  invoice_no: string;
  invoice_code: string;
  status: string;
  status_source: string;
  invoice_type: string;
  invoice_type_label: string;
  issued_on: string | null;
  buyer_name: string;
  buyer_tax_no: string | null;
  seller_name: string;
  seller_tax_no: string | null;
  amount: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  amount_check: string;
  remark: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  file_count: number | string;
  contract_count: number | string;
  /** 窗口聚合：整页同值 */
  total_count: number | string;
  sum_amount: string | null;
  sum_tax_amount: string | null;
  sum_total_amount: string | null;
  missing_amount_count: number | string;
  red_count: number | string;
}

/* ── SQL 片段 ─────────────────────────────────────────────── */

/**
 * 列表 / 详情共用的列清单。
 *
 * 统计走**窗口函数**而不是第二条 SQL：窗口聚合在 LIMIT 之前求值，
 * 所以一次扫描同时得到「本页 20 行」和「全量合计」。写成两条 SQL（count+sum 一条、
 * items 一条）等于两次全表扫，而且两次之间有人插一张票，就会出现
 * "合计和行数对不上"——这种不一致没人能复现，只会被当成系统不可信。
 *
 * `file_count` / `contract_count` 用相关子查询而不是 JOIN：JOIN 两张一对多表会让
 * 行数乘起来，必须 DISTINCT 才能除回来，那比子查询慢且更难读。
 *
 * `contract_count` **只数"还有效"的合同关联**（合同软删的不算）。理由不是洁癖：
 * 筛选参数 `has_contract=0` 用的是同一个口径，两边不一致就会出现
 * "在「还没挂合同」里筛出来的行，contract_count 却显示 1"——用户会认为筛选坏了，
 * 而这类"两处各算一套"的错没有任何报错，只能靠人发现。
 */
export const SELECT_INVOICE = `
  SELECT i.id, i.invoice_no, i.invoice_code, i.status, i.status_source,
         i.invoice_type, i.invoice_type_label, i.issued_on,
         i.buyer_name, i.buyer_tax_no, i.seller_name, i.seller_tax_no,
         i.amount, i.tax_amount, i.total_amount, i.amount_check, i.remark,
         i.created_at, i.updated_at, i.deleted_at,
         (SELECT count(*) FROM invoice_files f WHERE f.invoice_id = i.id)::int AS file_count,
         (SELECT count(*) FROM contract_invoices ci
             JOIN contracts c ON c.id = ci.contract_id AND c.deleted_at IS NULL
            WHERE ci.invoice_id = i.id)::int AS contract_count,
         count(*) OVER () AS total_count,
         coalesce(sum(i.amount)       OVER (), 0)::text AS sum_amount,
         coalesce(sum(i.tax_amount)   OVER (), 0)::text AS sum_tax_amount,
         coalesce(sum(i.total_amount) OVER (), 0)::text AS sum_total_amount,
         (count(*) FILTER (WHERE i.amount IS NULL OR i.tax_amount IS NULL OR i.total_amount IS NULL)
                 OVER ())::int AS missing_amount_count,
         (count(*) FILTER (WHERE i.status = 'red') OVER ())::int AS red_count
    FROM invoices i`;

/** 默认排序：开票日期倒序（没日期的排最后），再按录入时间兜底 */
export const INVOICE_ORDER = 'ORDER BY i.issued_on DESC NULLS LAST, i.created_at DESC';

/* ── 映射 ─────────────────────────────────────────────────── */

export function toInvoiceDTO(r: InvoiceRow): InvoiceDTO {
  return {
    id: r.id,
    invoice_no: r.invoice_no,
    invoice_code: r.invoice_code,
    // 库里的值认不出时按「正常票」显示：手工改库或以后加枚举都不该让列表炸掉
    status: isInvoiceStatus(r.status) ? r.status : 'normal',
    status_source: isInvoiceStatusSource(r.status_source) ? r.status_source : 'ocr',
    invoice_type: r.invoice_type,
    invoice_type_label: r.invoice_type_label,
    issued_on: r.issued_on,
    buyer_name: r.buyer_name,
    buyer_tax_no: r.buyer_tax_no,
    seller_name: r.seller_name,
    seller_tax_no: r.seller_tax_no,
    // numeric 经 db.ts 已是字符串，原样返回（绝不 Number()）
    amount: r.amount,
    tax_amount: r.tax_amount,
    total_amount: r.total_amount,
    amount_check: isAmountCheck(r.amount_check) ? r.amount_check : 'ok',
    remark: r.remark,
    file_count: Number(r.file_count ?? 0),
    contract_count: Number(r.contract_count ?? 0),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

/** 整页统计。没命中时返回全 0（不是 null）——界面直接显示，不用判空 */
export function toSummaryDTO(rows: InvoiceRow[]): InvoiceSummaryDTO {
  const first = rows[0];
  if (!first) {
    return {
      count: 0,
      sum_amount: '0',
      sum_tax_amount: '0',
      sum_total_amount: '0',
      missing_amount_count: 0,
      red_count: 0,
    };
  }
  return {
    count: Number(first.total_count ?? 0),
    sum_amount: first.sum_amount ?? '0',
    sum_tax_amount: first.sum_tax_amount ?? '0',
    sum_total_amount: first.sum_total_amount ?? '0',
    missing_amount_count: Number(first.missing_amount_count ?? 0),
    red_count: Number(first.red_count ?? 0),
  };
}

export function toInvoiceFileDTO(row: {
  id: string;
  storage: string;
  url: string;
  original_name: string;
  mime: string;
  size_bytes: string | number;
  created_at: Date;
}): InvoiceFileDTO {
  const storage: 'local' | 'cos' = row.storage === 'cos' ? 'cos' : 'local';
  const ext = (row.url.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? '';
  return {
    id: row.id,
    storage,
    url: row.url,
    original_name: row.original_name,
    mime: row.mime,
    ext,
    size_bytes: Number(row.size_bytes ?? 0),
    created_at: row.created_at.toISOString(),
  };
}

export function toInvoiceContractDTO(row: {
  id: string;
  contract_no: string | null;
  title: string;
  company_name: string;
  project_name: string | null;
  status: string;
  deleted_at: Date | null;
}): InvoiceContractDTO {
  return {
    id: row.id,
    contract_no: row.contract_no,
    title: row.title,
    company_name: row.company_name,
    project_name: row.project_name,
    status: isContractStatus(row.status) ? row.status : DEFAULT_CONTRACT_STATUS,
    deleted: row.deleted_at !== null,
  };
}
