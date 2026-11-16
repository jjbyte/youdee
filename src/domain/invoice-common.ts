/**
 * 发票领域的基础件：状态枚举、字段长度上限、基础清洗。
 *
 * 从 `invoice-record.ts` 拆出来的唯一原因是**单文件不超过 300 行**：
 * 金额那一套（容差 / 推导 / 符号）与录入校验（逐字段报错）各自都已经二百行，
 * 挤在一个文件里，半年后没人敢动其中任何一段。三者的边界是清楚的：
 *
 *   invoice-common.ts  枚举与长度上限、把脏字符串变成能入库的值（不含业务判断）
 *   invoice-money.ts   三项金额的口径：清洗、容差、缺项推导、红票判定与符号归一
 *   invoice-record.ts  录入 / 编辑的字段校验（谁必填、填错了怎么报），并转出上面两份
 *
 * 调用方只认 `@/domain/invoice-record` 一个入口（见那里的 `export *`）。
 */
import { isRealDate } from './contract';
import { toHalfWidth } from './phone';

/**
 * 全角转半角**只有一份**（在 phone.ts）：税号、电话、发票号码、金额都在用它。
 * domain 里出现两份"看起来一样、将来会分叉"的实现，代价是某个字段某天起认不出全角。
 */
export { toHalfWidth };

/* ── 枚举 ──────────────────────────────────────────────────── */

/** 正常票 / 冲红票。与软删（deleted_at）正交：冲红是业务状态，删除是可见性 */
export const INVOICE_STATUSES = [
  { value: 'normal', label: '正常' },
  { value: 'red', label: '冲红' },
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]['value'];

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return v === 'normal' || v === 'red';
}

export function invoiceStatusLabel(v: string | null | undefined): string {
  const hit = INVOICE_STATUSES.find((s) => s.value === v);
  return hit ? hit.label : INVOICE_STATUSES[0].label;
}

/** 状态来源：ocr 自动判定 / manual 人工改过（manual 不再被重传覆盖） */
export const INVOICE_STATUS_SOURCES = ['ocr', 'manual'] as const;
export type InvoiceStatusSource = (typeof INVOICE_STATUS_SOURCES)[number];

export function isInvoiceStatusSource(v: unknown): v is InvoiceStatusSource {
  return v === 'ocr' || v === 'manual';
}

/** 三项金额的自洽程度 */
export const INVOICE_AMOUNT_CHECKS = ['ok', 'derived', 'mismatch'] as const;
export type AmountCheck = (typeof INVOICE_AMOUNT_CHECKS)[number];

export function isAmountCheck(v: unknown): v is AmountCheck {
  return v === 'ok' || v === 'derived' || v === 'mismatch';
}

/* ── 字段长度上限（与 schema.prisma 的 varchar 一致）──────────── */

export const INVOICE_LIMITS = {
  invoiceNo: 32,
  invoiceCode: 20,
  invoiceType: 40,
  invoiceTypeLabel: 60,
  partyName: 200,
  taxNo: 30,
  remark: 2000,
  /** OCR 只认到 64 位，腾讯云 RequestId 实际 ~40 位 */
  requestId: 64,
  /** numeric(14,2)：整数部分 12 位 */
  amountIntDigits: 12,
} as const;

/* ── 基础清洗 ──────────────────────────────────────────────── */

/** 去掉控制字符与零宽字符，压缩连续空白。姓名 / 公司名用这个，不做全角转半角 */
export function normalizeText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 发票号码规范化：全角转半角 → 去空格与横杠 → 字母大写。
 *
 * 为什么必须归一：OCR 会把 `0` 认成 `O`、把空格当字符。不归一，同一张票
 * 重传一次就会被当成新票（唯一键命不中），台账里出现两行看起来一样的记录。
 *
 * 返回 null = 视为未识别（`[0-9A-Z]{6,32}` 之外一律不认，宁可让人重传，也不入库垃圾号）。
 */
export function normalizeInvoiceNo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = toHalfWidth(v).replace(/[\s\-_/]/g, '').toUpperCase();
  return /^[0-9A-Z]{6,32}$/.test(s) ? s : null;
}

/**
 * 发票代码规范化。全电票与多数电子票**没有代码**，一律返回空串（不是 null）。
 *
 * 唯一索引 `(invoice_code, invoice_no)` 对 NULL 不生效（多行 NULL 互不冲突），
 * 所以这里只能给空串 —— 否则同一张全电票能被录进去 N 遍。
 */
export function normalizeInvoiceCode(v: unknown): string {
  if (typeof v !== 'string') return '';
  return toHalfWidth(v).replace(/[\s\-_/]/g, '').toUpperCase().slice(0, INVOICE_LIMITS.invoiceCode);
}

/** 纳税人识别号：统一社会信用代码是 15/18/20 位字母数字。认不出返 null */
export function normalizeTaxNo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = toHalfWidth(v).replace(/[\s\-_/]/g, '').toUpperCase();
  if (!s) return null;
  return /^[0-9A-Z]{15,20}$/.test(s) ? s : s.slice(0, INVOICE_LIMITS.taxNo);
}

/**
 * 开票日期解析（`parseIssuedOn`）。
 *
 * 接受 `2026年04月11日` / `2026-04-11` / `2026/4/11` / `2026.04.11`，
 * 先全角转半角、去空白，再用 `isRealDate` 校验日历真实性（`2026-02-30` 拒）。
 *
 * 为什么不 `new Date()` 硬转：`new Date('2016年04月11日')` 是 Invalid Date，
 * 而 `new Date('2026-03-01')` 是 UTC 零点 —— 在 UTC+8 的机器上会退成 02-28，
 * 于是"3 月 1 日开的票"在台账里变成 2 月 28 日。日期只认字符串，不经过 Date 对象。
 *
 * 解析不出返回 null：不阻塞入库，但会在 warnings 里提一句（由调用方拼）。
 */
export function parseIssuedOn(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = toHalfWidth(v)
    .replace(/[\s\u00a0]/g, '')
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return isRealDate(iso) ? iso : null;
}