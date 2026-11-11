/**
 * 合同字段校验（纯函数，不依赖数据库与 HTTP）。
 *
 * 为什么单拎出来：合同是**人手工录的凭据**，字段脏了没有下游能纠正——
 * 报价单算错了还能重算，合同的公司名错了就是查不到。所以校验要能逐条单测，
 * 而不是埋在 route.ts 的 if 里。
 *
 * 约定与前端保持一致：
 *   - `undefined` = 这次没提交这个字段（PATCH 时不动它）
 *   - `null` / 空串 = 明确清空（可选字段）
 *   - 必填字段给空串是错误，不静默退回旧值
 */

export const CONTRACT_LIMITS = {
  title: 200,
  companyName: 120,
  /** 乙方：客户名称。与甲方同长 */
  customerName: 120,
  projectName: 200,
  contractNo: 60,
  note: 2000,
  /** numeric(14,2)：整数部分 12 位 */
  amountIntDigits: 12,
} as const;

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ParsedContract {
  contract_no: string | null;
  title: string;
  company_name: string;
  /** 客户名称（乙方）。可选：不是所有合同都能一眼看出乙方是谁 */
  customer_name: string | null;
  project_name: string | null;
  /** yyyy-mm-dd */
  signed_on: string | null;
  /** 十进制字符串（两位小数以内），交给 numeric 列 */
  amount: string | null;
  note: string | null;
}

type Raw = Record<string, unknown>;

function has(o: Raw, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** 字符串字段的三态：undefined 不提交 / null 空串 清空 / 其余 trim 后取值 */
function text(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).replace(/\u0000/g, '').trim();
  return s === '' ? null : s;
}

/**
 * 真实存在的日期。`2026-02-30` 这种「格式对、日历上不存在」的输入必须拒掉：
 * 存进 date 列会被 Postgres 转成 03-02，于是录错的人和查的人看到两个日期。
 */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 金额规范化：只接受十进制，最多两位小数，不接受科学计数法、千分位、货币符号。
 * 返回规范化字符串（去掉多余的前导 0），非法返回 null。
 *
 * 为什么在这里卡两位：numeric(14,2) 会**静默四舍五入**——录 1000.005 的人
 * 以为存的是 1000.005，查出来是 1000.01，对不上账时没人会想到是入库那一步。
 */
export function normalizeAmount(v: string): string | null {
  const s = v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac] = s.split('.');
  if (!int || int.length > CONTRACT_LIMITS.amountIntDigits) return null;
  const normalizedInt = int.replace(/^0+(?=\d)/, '');
  return frac === undefined ? normalizedInt : `${normalizedInt}.${frac}`;
}

export interface ParseResult {
  value: Partial<ParsedContract>;
  issues: FieldIssue[];
}

/**
 * 解析并校验提交体。
 *
 * @param raw  请求体（snake_case 键）
 * @param opts.partial  true = PATCH，只校验出现过的键；false = 新建，必填项必须给
 */
export function parseContractInput(raw: Raw, opts: { partial?: boolean } = {}): ParseResult {
  const partial = opts.partial === true;
  const issues: FieldIssue[] = [];
  const value: Partial<ParsedContract> = {};
  // 先收集再一次性合并：几个文本字段的键在 ParsedContract 里可空性不同，
  // 直接按 union key 赋值会被 TS 拦（title 不接受 null），中间对象绕开这个噪音
  const picked: Record<string, string | null> = {};

  const takeText = (key: string, field: string, max: number, required: boolean) => {
    if (!has(raw, key)) {
      if (!partial && required) issues.push({ field: key, message: `${field}不能为空。` });
      return;
    }
    const t = text(raw[key]);
    if (t === undefined) return;
    if (t === null) {
      if (required) issues.push({ field: key, message: `${field}不能为空。` });
      else picked[key] = null;
      return;
    }
    if (t.length > max) {
      issues.push({ field: key, message: `${field}最多 ${max} 个字。` });
      return;
    }
    picked[key] = t;
  };

  takeText('title', '合同名称', CONTRACT_LIMITS.title, true);
  takeText('company_name', '公司名称', CONTRACT_LIMITS.companyName, true);
  takeText('customer_name', '客户名称', CONTRACT_LIMITS.customerName, false);
  takeText('project_name', '项目名称', CONTRACT_LIMITS.projectName, false);
  takeText('contract_no', '合同编号', CONTRACT_LIMITS.contractNo, false);
  takeText('note', '备注', CONTRACT_LIMITS.note, false);

  if (has(raw, 'signed_on')) {
    const t = text(raw.signed_on);
    if (t === null) picked.signed_on = null;
    else if (t !== undefined) {
      if (!isRealDate(t)) {
        issues.push({ field: 'signed_on', message: '签订日期要写成 YYYY-MM-DD，而且得是日历上真有的那一天。' });
      } else {
        picked.signed_on = t;
      }
    }
  }

  if (has(raw, 'amount')) {
    const t = text(raw.amount);
    if (t === null) picked.amount = null;
    else if (t !== undefined) {
      const a = normalizeAmount(t);
      if (a === null) {
        issues.push({ field: 'amount', message: '合同金额只能填数字，最多两位小数，不能是负数。' });
      } else {
        picked.amount = a;
      }
    }
  }

  return { value: picked as Partial<ParsedContract>, issues };
}
