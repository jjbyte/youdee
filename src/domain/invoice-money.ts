/**
 * 金额口径：清洗 → 容差 → 缺项推导 → 红票判定 → 符号归一。
 *
 * 这一整套只有一条铁律：**金额永远不经过 `Number`**。三个数一律在 BigInt 分（scale=2）
 * 上相加相减，容差是 1 分；转成 JS number 的那一刻，1234567890.12 就开始丢位，
 * 而这三个数是拿去对账的。
 *
 * 为什么值得单独成文件：这里的每个函数都被三处调用（OCR 识别、手工录入、改状态），
 * 而它们的共同前提——"缺项怎么推""冲红怎么定符号""什么算负数"——只有摆在一起
 * 才能一眼看出是否自洽。散在三个文件里，就会出现"入库一套符号口径、改状态另一套"。
 */
import { fmtAmount, parseAmount } from './money';
import { INVOICE_LIMITS, toHalfWidth } from './invoice-common';
import type { AmountCheck, InvoiceStatus } from './invoice-common';

/**
 * 金额文本 → 两位小数十进制字符串（正数向；符号由 `signAmounts` 统一决定）。
 *
 * OCR 的金额可能是 `¥1,234.5`、`1 234.50`、`１００．００`、`-113.00`。
 * 清洗顺序：全角转半角 → 去空白 → 去货币符号与千分位 → 去尾缀「元」→ 校验。
 * 认不出返回 null；**绝不返回 '0.00'** —— 那会把"没认出来"变成"确实是零"。
 */
export function parseOcrMoney(v: unknown): string | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? moneyFromDecimalString(String(v)) : null;
  }
  if (typeof v !== 'string') return null;
  const cleaned = toHalfWidth(v)
    .replace(/[\s\u00a0]/g, '')
    .replace(/[¥￥$]/g, '')
    .replace(/,/g, '')
    .replace(/元$/, '')
    .replace(/[−－—]/g, '-');
  if (!cleaned) return null;
  return moneyFromDecimalString(cleaned);
}

/** 内部：`-123.4` → `'123.40'`（只保正值，符号统一由 signAmounts 决定） */
function moneyFromDecimalString(s: string): string | null {
  const raw = s.startsWith('-') ? s.slice(1) : s;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [int = '0', frac = ''] = raw.split('.');
  if (int.replace(/^0+(?=\d)/, '').length > INVOICE_LIMITS.amountIntDigits) return null;
  try {
    // parseAmount 是 scale=2 定点解析（HALF_UP），超过两位小数会进位而不是被库静默截断
    const cents = parseAmount(raw);
    return cents < 0n ? null : fmtAmount(cents);
  } catch {
    return null;
  }
}

/** 十进制字符串 → 分（BigInt）。空 / 非法返回 null */
export function toCents(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return parseAmount(v);
  } catch {
    return null;
  }
}

/* ── 三项金额：容差与推导（Spec §3.1）────────────────────────── */

/** 容差 0.01 元（1 分）。OCR 的 1–2 分误差是多行明细合计的行业常态 */
export const AMOUNT_TOLERANCE_CENTS = 1n;

export interface InvoiceAmounts {
  amount: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
}

export interface ReconcileResult {
  /** 一律非负两位小数字符串；符号由 signAmounts 决定 */
  amounts: InvoiceAmounts;
  check: AmountCheck;
  /** 给人看的一句话（进 warnings / 界面黄标），没有问题时为 null */
  warning: string | null;
}

/**
 * 三项金额的容差判定与缺项推导（Spec §3.1）。
 *
 *   1. 三项齐全：|amount + tax - total| ≤ 0.01 → ok；否则 mismatch（**仍入库**，界面标黄）
 *   2. 缺一项、另两项齐全：用 total 为真值推导缺项 → derived
 *   3. 缺两项及以上：原样存，check = ok（不推导、不报错）
 *
 * 为什么不直接拒绝 mismatch：OCR 差 1–2 分是常态，拒绝入库等于让用户为 OCR 的误差返工，
 * 而"传 20 张失败 6 张"比"合计里混进一张差 1 分的票"严重得多。
 * 为什么不推 derived 时用浮点：`113.03 - 100.00` 在浮点里是 `13.030000000000001`，
 * 库层会静默四舍五入，于是推出来的数和它自己不自洽。这里全程 BigInt 分。
 *
 * 入参各自经过 `toCents`（负数取绝对值的口径由调用方保证：先判红票，再调这里）。
 */
export function reconcileAmounts(input: InvoiceAmounts): ReconcileResult {
  const pick = (v: string | null): bigint | null => {
    const c = toCents(v);
    return c === null ? null : c < 0n ? -c : c;
  };
  const a = pick(input.amount);
  const t = pick(input.taxAmount);
  const g = pick(input.totalAmount);

  const present = [a, t, g].filter((x) => x !== null).length;
  const out = (x: bigint | null): string | null => (x === null ? null : fmtAmount(x));

  if (present === 3 && a !== null && t !== null && g !== null) {
    const diff = a + t - g;
    if (diff >= -AMOUNT_TOLERANCE_CENTS && diff <= AMOUNT_TOLERANCE_CENTS) {
      return { amounts: { amount: out(a), taxAmount: out(t), totalAmount: out(g) }, check: 'ok', warning: null };
    }
    const abs = diff < 0n ? -diff : diff;
    return {
      amounts: { amount: out(a), taxAmount: out(t), totalAmount: out(g) },
      check: 'mismatch',
      warning: `金额三项差 ${fmtAmount(abs)} 元（${fmtAmount(a)} + ${fmtAmount(t)} ≠ ${fmtAmount(g)}），已标黄`,
    };
  }

  if (present === 2) {
    if (a === null && t !== null && g !== null) {
      const derived = g - t;
      return {
        amounts: { amount: out(derived < 0n ? 0n : derived), taxAmount: out(t), totalAmount: out(g) },
        check: 'derived',
        warning: '不含税金额没认出来，已按「价税合计 − 税额」推算',
      };
    }
    if (t === null && a !== null && g !== null) {
      const derived = g - a;
      return {
        amounts: { amount: out(a), taxAmount: out(derived < 0n ? 0n : derived), totalAmount: out(g) },
        check: 'derived',
        warning: '税额没认出来，已按「价税合计 − 不含税金额」推算',
      };
    }
    if (g === null && a !== null && t !== null) {
      return {
        amounts: { amount: out(a), taxAmount: out(t), totalAmount: out(a + t) },
        check: 'derived',
        warning: '价税合计没认出来，已按「不含税金额 + 税额」推算',
      };
    }
  }

  // 缺两项及以上：能存几个存几个，不推导也不报错。
  // 只有 total 一张票是常见的（部分电子票无价税分离），硬要它"自洽"只会逼用户瞎填一个数。
  return {
    amounts: { amount: out(a), taxAmount: out(t), totalAmount: out(g) },
    check: 'ok',
    warning: null,
  };
}

/* ── 红票判定与符号归一（Spec §5.5）──────────────────────────── */

export interface DetectedStatus {
  status: InvoiceStatus;
  /** 判定依据，写进日志与 ocr_raw 旁边的备注，便于复核 */
  reason: 'amount_negative' | 'title_red' | 'heuristic_normal';
}

/**
 * 这段金额文本是不是负数。
 *
 * 为什么要单独判而不是 `Number(x) < 0`：OCR 的原始文本可能是 `¥-1,130.00`、
 * `−1130.00`（全角减号）、`- 1130.00`（中间有空格）。而且**清洗后的金额一定不带负号**
 * （`parseOcrMoney` 只保数值，符号由 signAmounts 决定），所以红票判定必须看原始文本，
 * 拿清洗后的数去判会得到"永远是正数"，红票就被当成正常票入账。
 */
export function isNegativeAmountText(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = toHalfWidth(v)
    .replace(/[\s\u00a0¥￥$,]/g, '')
    .replace(/[−－—]/g, '-');
  return s.startsWith('-');
}

/**
 * 冲红判定（启发式）。
 *
 * 已核实：`RecognizeGeneralInvoice` 返回的 `VatInvoiceInfo` / `VatElectronicInfo`
 * **没有红票标记字段**（`RedLetterInvoiceMark` 只在 `VatInvoiceVerify` 的结构体里）。
 * 所以只能：
 *   1. 三项金额任一为负 → red（用的是**原始文本**，见 `isNegativeAmountText`）
 *   2. 票面名称 / 票种描述 / **备注** 含「红字」「红冲」「冲红」→ red
 *   3. 其它 → normal
 *
 * 为什么要把备注也算进来：数电红字发票的票面标题常常仍是「电子发票（普通发票）」，
 * 红字信息只出现在备注里（如「被红冲蓝字数电发票号码：xxx」）。只看标题会漏判，
 * 而漏判的代价是合计里多进一笔正数。
 *
 * 判定错的代价是合计偏大或偏小，所以入库后必须让人能改（`status_source='manual'`）。
 */
export function detectInvoiceStatus(input: {
  title?: string | null;
  typeLabel?: string | null;
  /** 票面备注。红字发票的红冲信息常只在这里出现 */
  remark?: string | null;
  /** OCR 原始文本或已清洗的金额都可以：负号按文本判 */
  amounts: InvoiceAmounts;
}): DetectedStatus {
  const anyNegative = [input.amounts.amount, input.amounts.taxAmount, input.amounts.totalAmount].some(
    isNegativeAmountText,
  );
  if (anyNegative) return { status: 'red', reason: 'amount_negative' };

  const text = `${input.title ?? ''}${input.typeLabel ?? ''}${input.remark ?? ''}`;
  if (text.includes('红字') || text.includes('红冲') || text.includes('冲红')) {
    return { status: 'red', reason: 'title_red' };
  }

  return { status: 'normal', reason: 'heuristic_normal' };
}

/**
 * 强制重定符号：red → 三项负数，normal → 三项正数。
 *
 * 唯一使用场景是**人工改状态**（`PATCH /invoices/:id/status`，仅管理员）。
 * 这一步和改 status 必须在同一个事务里完成：只改状态不改符号，
 * 就会出现"冲红 3 张但合计没变"，而这种 bug 只有对账时才会被发现。
 */
export function signAmounts(amounts: InvoiceAmounts, status: InvoiceStatus): InvoiceAmounts {
  const apply = (v: string | null): string | null => {
    const c = toCents(v);
    if (c === null) return v;
    const abs = c < 0n ? -c : c;
    return fmtAmount(status === 'red' ? -abs : abs);
  };
  return {
    amount: apply(amounts.amount),
    taxAmount: apply(amounts.taxAmount),
    totalAmount: apply(amounts.totalAmount),
  };
}

/**
 * 入库时的符号（与 `signAmounts` 的区别只有一点）：
 *   - red → 取负（原本已是负数也取负，避免 `--` 得正）
 *   - normal → **保持原符号**，但出现负号说明判定可能错了，记一条 warning 让人复核
 *
 * 为什么 normal 不强行取正：手工录入的人可能故意填负数（比如先记一张要冲的票），
 * 强行取正等于替他改数。而统计口径的一致性由 red/normal 的状态本身保证。
 */
export function applyDetectedSign(
  amounts: InvoiceAmounts,
  status: InvoiceStatus,
): { amounts: InvoiceAmounts; warning: string | null } {
  if (status === 'red') return { amounts: signAmounts(amounts, 'red'), warning: null };
  const negative = [amounts.amount, amounts.taxAmount, amounts.totalAmount].some(
    (v) => (toCents(v) ?? 0n) < 0n,
  );
  return {
    amounts,
    warning: negative ? '这张票状态是「正常」但有一项金额是负数，请确认是不是冲红票' : null,
  };
}