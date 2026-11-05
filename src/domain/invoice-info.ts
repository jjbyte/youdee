/**
 * 开票信息：纳税人识别号 / 地址 / 电话 / 开户银行 / 银行账号。
 *
 * 这五项**只在开发票那一刻**用得上，但它们错了的代价发生在几周后（票开错被退回重开），
 * 所以输入时就地校验，而不是等财务打电话来问"这家税号是多少"。
 *
 * 五个字段全部可选，一个都不填也能建档、录价、比价、出单——
 * 客户的原话是"可选字段"，加字段不能顺手变成加门槛。
 *
 * 与服务端无关的纯函数：路由层、编辑抽屉、单测读的是同一份规则。
 * 两边各写一遍正则，是最容易出现"界面放行、接口报错"的做法。
 */

import { PHONE_MIN_DIGITS, cleanPhone, phoneDigitCount, toHalfWidth } from './phone';

export interface InvoiceInfo {
  tax_no: string | null;
  company_address: string | null;
  company_phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
}

export type InvoiceKey = keyof InvoiceInfo;

/** 顺序即界面顺序，也是财务念发票的顺序：名称（供应商名已在上面）→ 税号 → 地址 → 电话 → 开户行 → 账号 */
export const INVOICE_KEYS: InvoiceKey[] = ['tax_no', 'company_address', 'company_phone', 'bank_name', 'bank_account'];

export const INVOICE_LABELS: Record<InvoiceKey, string> = {
  tax_no: '纳税人识别号',
  company_address: '公司地址',
  company_phone: '联系电话',
  bank_name: '开户银行',
  bank_account: '银行账号',
};

/** 数据库列宽，界面 maxLength 与服务端 optStr 共用，避免"存进去被截断" */
export const INVOICE_MAX: Record<InvoiceKey, number> = {
  tax_no: 30,
  company_address: 200,
  company_phone: 30,
  bank_name: 100,
  bank_account: 50,
};

export interface NormalizeResult {
  value: string | null;
  error?: string;
}

/** 全角数字/字母 → 半角。报价员从微信里复制过来的税号常是全角 */

/**
 * 纳税人识别号：15 位老税号 / 18 位统一社会信用代码 / 20 位个别地区。
 * 只校验"长度 + 字符集"，**不校验校验位**——校验位算法一旦算错，
 * 正确的新税号会被判成非法，那时的代价比现在大得多（人会被迫瞎填一个能过的）。
 */
export function normalizeTaxNo(raw: unknown): NormalizeResult {
  // 横杠和空格都是抄写时的手感，不是税号的一部分；字母一律大写
  const s = toHalfWidth(String(raw ?? '')).replace(/[\s\-－—_]/g, '').toUpperCase();
  if (!s) return { value: null };
  if (!/^[0-9A-Z]{15,20}$/.test(s)) {
    return { value: null, error: '税号是 15–20 位字母或数字（统一社会信用代码 18 位），去掉空格和横杠。' };
  }
  return { value: s };
}

/**
 * 银行账号：只留数字。空格和「-」是抄写时顺手加的分隔符，不是账号的一部分。
 * 长度放宽到 6–32 位：这个系统不该假装知道每家银行的账号规则。
 */
export function normalizeBankAccount(raw: unknown): NormalizeResult {
  const s = toHalfWidth(String(raw ?? '')).replace(/[\s\-－—_]/g, '');
  if (!s) return { value: null };
  if (!/^\d{6,32}$/.test(s)) {
    return { value: null, error: '银行账号只填数字，空格和「-」会自动去掉。' };
  }
  return { value: s };
}

/** 联系电话：允许 + - 空格 括号，但至少要有 7 位数字（座机 8 位、手机 11 位都不至于更短） */
export function normalizeInvoicePhone(raw: unknown): NormalizeResult {
  const s = cleanPhone(raw);
  if (!s) return { value: null };
  if (phoneDigitCount(s) < PHONE_MIN_DIGITS) {
    return { value: null, error: '这个电话太短了，写一个财务能打通或者能开的号。' };
  }
  if (s.length > INVOICE_MAX.company_phone) {
    return { value: null, error: `联系电话最多 ${INVOICE_MAX.company_phone} 个字符。` };
  }
  return { value: s };
}

/** 地址 / 开户银行：只做 trim + 长度，不猜内容（"工行杭州分行"和"中国工商银行…"都对） */
export function normalizeInvoiceText(key: InvoiceKey, raw: unknown): NormalizeResult {
  const s = toHalfWidth(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  if (!s) return { value: null };
  if (s.length > INVOICE_MAX[key]) {
    return { value: null, error: `${INVOICE_LABELS[key]}最多 ${INVOICE_MAX[key]} 个字符。` };
  }
  return { value: s };
}

/** 按字段分派。界面逐格调用它拿 error，服务端逐个字段收集第一条错误 */
export function normalizeInvoiceField(key: InvoiceKey, raw: unknown): NormalizeResult {
  if (key === 'tax_no') return normalizeTaxNo(raw);
  if (key === 'bank_account') return normalizeBankAccount(raw);
  if (key === 'company_phone') return normalizeInvoicePhone(raw);
  return normalizeInvoiceText(key, raw);
}

/** 五项里填了几项——详情抽屉用它决定"要不要显示这一块" */
export function invoiceFilledCount(info: Partial<InvoiceInfo> | null | undefined): number {
  if (!info) return 0;
  return INVOICE_KEYS.filter((k) => {
    const v = info[k];
    return v !== null && v !== undefined && String(v).trim() !== '';
  }).length;
}
