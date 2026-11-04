/**
 * 金额运算（零浮点，零依赖，前后端共用）
 *
 * 为什么不用 number：0.1 + 0.2 !== 0.3，报价单上任何一个分位的偏差都会
 * 让客户对账对不上。为什么不用 decimal.js：这是报价系统的核心路径，
 * 少一个运行时依赖少一个风险点，且 BigInt 定点运算足够表达本项目全部场景。
 *
 * 定点约定：
 *   unitPrice  scale = 4（元/单位，如 12.3456 元/㎡）
 *   amount     scale = 2（元，行小计/合计）
 *   qty        scale = 2（数量，如 3.50 天、120.00 张）
 *
 * 舍入：ROUND_HALF_UP（财务惯例）。注意 JS 的 toFixed 是 half-even，
 * 2.5.toFixed(0) === "2"，与财务预期相反 —— 本项目禁用 toFixed 做金额舍入。
 */

export const SCALE_MONEY = 4;
const S_MONEY = 10n ** 4n;
const S_AMOUNT = 10n ** 2n;
const S_QTY = 10n ** 2n;
/** 折算系数的标度。DB 是 numeric(12,6)，必须按 6 位解析，否则 0.055556 会被截成 0.0555 */
export const SCALE_RATIO = 6;
const S_RATIO = 10n ** 6n;

export type MoneyInput = string | number | bigint | null | undefined;

/**
 * 通用定点解析。**超出目标标度的位一律 ROUND_HALF_UP，不截断。**
 *
 * 截断看着"保守"，实际是制造两个不一样的数：折算系数 0.055556 按 scale4 截断成
 * 0.0555，于是比价页算出 80.4750，而取价 / 报价成本走 SQL numeric 得 80.5562。
 * 同一个价在两个页面上显示两个数，用户会开始怀疑这个系统所有的数。
 */
function parseScaled(v: MoneyInput, scale: number, label: string): bigint {
  if (v === null || v === undefined || v === '') {
    throw new Error(`${label}不能为空`);
  }
  const unit = 10n ** BigInt(scale);
  if (typeof v === 'bigint') return v * unit;

  const raw = typeof v === 'number' ? numToPlainString(v) : String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${label}格式非法: ${String(v)}`);
  }
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const [intPart = '0', fracRaw = ''] = body.split('.');

  const keep = (fracRaw + '0'.repeat(scale)).slice(0, scale);
  let scaled = BigInt(intPart) * unit + BigInt(keep || '0');

  // 被丢掉的第 scale+1 位若 >= 5，进位（HALF_UP）
  if (fracRaw.length > scale && Number(fracRaw[scale]) >= 5) {
    scaled += 1n;
  }
  return neg ? -scaled : scaled;
}

/** 解析为 scale=4 的定点整数（单价口径）。非法输入抛错，绝不静默变 0。 */
export function parseMoney(v: MoneyInput): bigint {
  return parseScaled(v, 4, '金额');
}

/**
 * 【注意】格式化函数按**输入标度**分三个，名字里带清楚，不许混用：
 *
 *   fmtPrice(p4, decimals) —— 输入单价（scale 4），输出 2 或 4 位小数
 *   fmtAmount(a2)          —— 输入金额（scale 2），输出 2 位小数
 *   fmtQty(q2)             —— 输入数量（scale 2），输出 2 位小数
 *
 * 曾经只有一个 `toMoneyString(v, scale)`，第二个参数到底是"输入标度"还是
 * "输出位数"说不清，结果把 scale2 的金额当 scale4 格式化，2000 元显示成 20 元。
 * 这种错误不抛异常、不报错，只是数字小了 100 倍 —— 属于最危险的一类。
 */

/** 单价（scale 4）→ 字符串 */
export function fmtPrice(scaled4: bigint, decimals: 2 | 4 = 4): string {
  const neg = scaled4 < 0n;
  const abs = neg ? -scaled4 : scaled4;
  const v = decimals === 4 ? abs : divRoundHalfUp(abs, 100n) * 100n;
  const int = v / S_MONEY;
  const frac = (v % S_MONEY) / (decimals === 4 ? 1n : 100n);
  return `${neg ? '-' : ''}${int}.${String(frac).padStart(decimals, '0')}`;
}

/** 金额（scale 2）→ 两位小数字符串 */
export function fmtAmount(scaled2: bigint): string {
  const neg = scaled2 < 0n;
  const abs = neg ? -scaled2 : scaled2;
  const int = abs / S_AMOUNT;
  const frac = abs % S_AMOUNT;
  return `${neg ? '-' : ''}${int}.${String(frac).padStart(2, '0')}`;
}

/** 数量（scale 2）→ 两位小数字符串 */
export function fmtQty(scaled2: bigint): string {
  const neg = scaled2 < 0n;
  const abs = neg ? -scaled2 : scaled2;
  const int = abs / S_QTY;
  const frac = abs % S_QTY;
  return `${neg ? '-' : ''}${int}.${String(frac).padStart(2, '0')}`;
}

/** 金额展示口径：scale4 输入 → 两位小数（HALF_UP） */
export function formatMoney(scaled4: bigint): string {
  return fmtPrice(scaled4, 2);
}

/** 解析金额为 scale=2 定点整数（行小计、合计、优惠额用这个，不要用 parseMoney） */
export function parseAmount(v: MoneyInput): bigint {
  return parseScaled(v, 2, '金额');
}

/** 解析数量为 scale=2 定点整数 */
export function parseQty(v: MoneyInput): bigint {
  return parseScaled(v, 2, '数量');
}

/**
 * 解析折算系数为 scale=6 定点整数。
 * 必须单独一个函数：折算系数不是金额也不是数量，它是「1 个基准单位 = N 个本价格单位」
 * 这个比例。用 parseMoney（scale4）解析 numeric(12,6) 的系数会丢两位有效数字。
 */
export function parseRatio(v: MoneyInput): bigint {
  return parseScaled(v, SCALE_RATIO, '折算系数');
}

/** 单价(scale4) × 数量(scale2) → 金额(scale2)，HALF_UP */
export function multiplyPriceByQty(unitPrice: bigint, qty: bigint): bigint {
  // (p/1e4) * (q/1e2) = p*q / 1e6 元 → 目标单位 1e2（分） ⇒ /1e4
  const prod = unitPrice * qty; // scale 6
  return divRoundHalfUp(prod, 10n ** 4n); // → scale 2
}

/**
 * 单价折算：base_unit_price = unit_price × base_unit_qty
 * baseUnitQty 为 NULL 表示未填 → 抛错，调用方必须先判断可比性。
 * 口径一律乘法（Spec §5.2 红线 12），全项目不出现除法。
 */
export function applyConversion(unitPrice: bigint, baseUnitQty: MoneyInput): bigint {
  if (baseUnitQty === null || baseUnitQty === undefined) {
    throw new Error('未填折算系数，该价格不参与比价');
  }
  // unitPrice scale4 × ratio scale6 = scale10 → 回到 scale4 需 /1e6
  const bq = parseRatio(baseUnitQty);
  return divRoundHalfUp(unitPrice * bq, S_RATIO);
}

/**
 * 数量换算到该供应商的计价单位：qty_priced = qty_base × base_unit_qty
 * 例：基准 ㎡、该供应商按张报、1㎡=12张 → qtyPriced = qtyBase × 12
 */
export function qtyToPricingUnit(qtyBase: bigint, baseUnitQty: MoneyInput): bigint {
  if (baseUnitQty === null || baseUnitQty === undefined) {
    throw new Error('未填折算系数，无法换算数量');
  }
  const bq = parseRatio(baseUnitQty);
  // qty scale2 × ratio scale6 = scale8 → 回到 scale2 需 /1e6
  return divRoundHalfUp(qtyBase * bq, S_RATIO);
}

/** 由成本与目标毛利率反推对客价：sale = cost / (1 - margin)，HALF_UP 到分 */
export function priceFromMargin(costUnitPrice: bigint, marginRate: number): bigint {
  if (marginRate >= 1 || marginRate <= -1) {
    throw new Error(`毛利率非法: ${marginRate}`);
  }
  const denom = 1 - marginRate;
  // 用整数表达 denom，避免浮点：margin 视为 4 位小数
  const denomScaled = BigInt(Math.round(denom * 10000));
  if (denomScaled === 0n) throw new Error('毛利率为 100%，无法反推对客价');
  // cost(scale4) / (denomScaled/1e4) = cost*1e4/denomScaled  (scale4)
  return divRoundHalfUp(costUnitPrice * 10000n, denomScaled);
}

/** 毛利率 = 利润 / 报价合计（分母是报价合计，不是成本 —— 这是毛利率而非加成率） */
export function marginRate(profit: bigint, priceTotal: bigint): number | null {
  if (priceTotal === 0n) return null; // 分母为 0 显示 em dash，不是 0%
  // 返回 4 位小数精度的浮点数，仅用于展示与阈值比较，不参与金额计算
  const scaled = divRoundHalfUp(profit * 10000n, priceTotal);
  return Number(scaled) / 10000;
}

/** HALF_UP 整数除法（BigInt 的 / 是向零截断，负数需单独处理） */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('除数为 0');
  const neg = (numerator < 0n) !== (denominator < 0n);
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const q = a / b;
  const r = a % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** number 转十进制字符串，避免 1e-7 这类科学计数法进入解析 */
function numToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`金额非法: ${n}`);
  const s = n.toString();
  if (!/e/i.test(s)) return s;
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}
