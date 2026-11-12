/**
 * 金额 / 数量 / 比率 / 日期的唯一格式化出口。
 *
 * 铁律（03-UIUX §B.7 / §F.3）：
 *   - 金额永远 2 位小数、千分位半角逗号、负号用 U+2212（与数字同宽）
 *   - 缺失值显示 em dash（—），不是 0，也不是空白
 *   - 毛利率 1 位小数；数量整数不带小数点
 *   - 页面里禁止各写各的 toFixed
 */

export const EM_DASH = '\u2014';
export const MINUS = '\u2212';

export function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 纯数字：12,480.00（不带货币符号，负号用 −） */
export function formatNumber(
  v: string | number | null | undefined,
  decimals = 2,
  empty: string = EM_DASH,
): string {
  const n = toNum(v);
  if (n === null) return empty;
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [intPart = '0', frac = ''] = fixed.split('.');
  const body = decimals > 0 ? `${group(intPart)}.${frac}` : group(intPart);
  return neg && Number(fixed) !== 0 ? `${MINUS}${body}` : body;
}

/** 金额：默认不带 ¥（列头只出现一次），需要时传 symbol */
export function formatMoney(
  v: string | number | null | undefined,
  opts: { decimals?: number; symbol?: boolean; empty?: string } = {},
): string {
  const { decimals = 2, symbol = false, empty = EM_DASH } = opts;
  const n = toNum(v);
  if (n === null) return empty;
  const s = formatNumber(n, decimals, empty);
  return symbol ? `¥${s}` : s;
}

/** 数量：整数不带小数点，非整数最多 2 位 */
export function formatQty(v: string | number | null | undefined, empty: string = EM_DASH): string {
  const n = toNum(v);
  if (n === null) return empty;
  if (Number.isInteger(n)) return formatNumber(n, 0);
  return formatNumber(n, 2).replace(/\.?0+$/, '');
}

/** 比率：0.415 → 41.5%（分母为 0 时后端给 null → —） */
export function formatRate(v: string | number | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n === null) return EM_DASH;
  const pct = n * 100;
  const sign = pct < 0 ? MINUS : '';
  return `${sign}${Math.abs(pct).toFixed(decimals)}%`;
}

/** 已经是百分数的值（如 12.5 表示 12.5%） */
export function formatPct(v: string | number | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n === null) return EM_DASH;
  const sign = n < 0 ? MINUS : '';
  return `${sign}${Math.abs(n).toFixed(decimals)}%`;
}

/**
 * 比率 → 百分比输入框里的**值**（不是展示文案）：0.28 → "28"，0.185 → "18.5"，null → ""。
 *
 * 不能直接写 String(n * 100)：0.28 * 100 = 28.000000000000004，
 * 输入框里就会显示成一长串没法看的数。先放大到万分之一位取整再缩回来。
 */
export function rateToPctInput(v: string | number | null | undefined): string {
  const n = toNum(v);
  if (n === null) return '';
  return String(Math.round(n * 10000) / 100);
}

/** 涨跌幅：delta 是比率（0.077 → ↑7.7%），0 或 null → — */
export function formatDelta(v: string | number | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n === null || n === 0) return EM_DASH;
  const arrow = n > 0 ? '↑' : '↓';
  return `${arrow}${Math.abs(n * 100).toFixed(decimals)}%`;
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 相对时间优先：今天 09:24 / 昨天 18:42 / 09-24 / 2025-03-11 */
export function formatTimeRel(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `今天 ${hh}:${mm}`;
  if (sameDay(d, yesterday)) return `昨天 ${hh}:${mm}`;
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (d.getFullYear() === now.getFullYear()) return md;
  return `${d.getFullYear()}-${md}`;
}

/** 绝对日期：2026-01-18 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  return String(iso).slice(0, 10);
}

/** 短日期：01-18 */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  return String(iso).slice(5, 10);
}

/** 陈旧天数：187 天（这个数字本身就是警告，只在风险提示里用） */
export function formatStaleDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return EM_DASH;
  return `${days} 天`;
}

export interface ParseResult {
  value: string | null;
  note?: string;
  error?: string;
}

/**
 * 数字输入的容错（§E.2）：报价员在客户现场打电话改数，输入必然不干净。
 * 支持 1,200 / ¥45 / 45元 / 1.2万 / 1e3 / 3*4 / 全角。
 * 猜完告诉他怎么猜的，但绝不悄悄改成完全不同的数。
 */
export function parseLooseNumber(raw: string, opts: { allowNegative?: boolean } = {}): ParseResult {
  const input = raw.trim();
  if (!input) return { value: null };
  const normalized = input
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥元]/g, '')
    .replace(/[,\s]/g, '');

  const mul = /^(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)$/.exec(normalized);
  if (mul) {
    const a = Number(mul[1]);
    const b = Number(mul[2]);
    const v = a * b;
    return { value: String(v), note: `已按 ${mul[1]} × ${mul[2]} = ${v} 计算` };
  }

  const wan = /^(-?\d+(?:\.\d+)?)\s*(?:万|w)$/i.exec(normalized);
  if (wan) {
    const single = Number(wan[1]);
    const v = single * 10000;
    return { value: String(v), note: `已按 ${wan[1]} 万 = ${formatNumber(v, 0)} 处理` };
  }

  if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(normalized)) {
    return { value: null, error: '只填数字' };
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { value: null, error: '只填数字' };
  if (n < 0 && !opts.allowNegative) {
    return { value: null, error: '金额不能为负，如果是退项请单独加一行负数项' };
  }
  return { value: String(n) };
}

/** 单价 2 位小数上限的静默四舍五入 */
export function round2(v: string | number): string {
  const n = toNum(v);
  if (n === null) return '';
  return n.toFixed(2);
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * 附件大小。展示用，不追求精确：1.2 MB 比 1.18 MB 好读。
 * 0 或负数返回空串 —— 老数据里 size_bytes 可能是 0，写成"0 KB"像文件坏了。
 */
export function fileSize(n: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
