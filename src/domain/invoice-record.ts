/**
 * 发票领域纯函数（零依赖、可单测、前后端共用）。
 *
 * 这里只做"把脏字符串变成能入库的值"和"三项金额到底自不自洽"这两件事。
 * 之所以单拎出来：发票是**财务拿去对账的数**，OCR 回来的东西又天然脏
 * （`SellerTaxID` 会被认成 `SellerTax1D`、金额可能带千分位与「¥」、
 * 日期是 `2016年04月11日`），这些规则埋在 route 的 if 里就没法逐条证明它对。
 *
 * 三条写死在类型上的约定：
 *   1) 金额一律**十进制字符串**，两位小数。内部判定用 BigInt 分（scale=2），
 *      绝不出现 `Number()` 参与求和或差值比较。
 *   2) `null` = 没识别出来，`0.00` = 确实是零。两者不可互换 ——
 *      用 0 冒充会让"金额合计"少算却不报警，而合计正是对账凭据。
 *   3) `status` 与符号绑定：red → 三项负数，normal → 正数。
 *      改状态不重定符号，就会出现"冲红 3 张但合计没变"，而这种 bug 只有对账时才会被发现。
 *
 * ── 本文件只保留录入 / 编辑的字段校验 ─────────────────────────
 * 枚举与基础清洗在 `invoice-common.ts`，金额口径在 `invoice-money.ts`。
 * 两份都在文件末尾 `export *` 转出：调用方只认这一个入口，内部怎么拆不影响他们。
 */
import {
  INVOICE_LIMITS,
  isInvoiceStatus,
  normalizeInvoiceCode,
  normalizeInvoiceNo,
  normalizeTaxNo,
  normalizeText,
  parseIssuedOn,
} from './invoice-common';
import { parseOcrMoney, reconcileAmounts, signAmounts, toCents } from './invoice-money';
import type { AmountCheck, InvoiceStatus } from './invoice-common';
import type { InvoiceAmounts } from './invoice-money';

export * from './invoice-common';
export * from './invoice-money';

/* ── 手工录入 / 编辑的字段校验 ───────────────────────────────── */

export interface ParsedInvoice {
  invoice_no: string;
  invoice_code: string;
  status: InvoiceStatus;
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
  /** 三项金额的自洽结论：由 `reconcileAmounts` 算出来，**不是用户填的**（提交了也忽略） */
  amount_check?: AmountCheck;
  remark: string | null;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ParseInvoiceResult {
  value: Partial<ParsedInvoice>;
  issues: FieldIssue[];
  /** 金额三项被重新定过符号 / 推算过时给一句提示 */
  notes: string[];
}

type Raw = Record<string, unknown>;

function has(o: Raw, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** 三态文本：undefined 不提交 / null 或空串清空 / 其余 trim 后取值 */
function tri(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = normalizeText(v);
  return s === '' ? null : s;
}

/**
 * 手工录入（POST）与编辑（PATCH）共用的解析器。
 *
 * 与 OCR 链路的区别：这里的值是人填的，**填错要报错**（不静默纠正）；
 * 而 OCR 的值是机器认的，认不出就留空 + 提示。
 *
 * 三项金额在这里就跑一次容差与推导：手工录入同样会出现"只填了价税合计"的情况，
 * 而合计对不对是财务报表上唯一看得见的数。
 */
export function parseInvoiceInput(
  raw: Raw,
  opts: { partial?: boolean; statusFallback?: InvoiceStatus } = {},
): ParseInvoiceResult {
  const partial = opts.partial === true;
  const statusFallback = opts.statusFallback ?? 'normal';
  const issues: FieldIssue[] = [];
  const notes: string[] = [];
  const picked: Record<string, unknown> = {};

  const takeText = (key: string, field: string, max: number, required: boolean) => {
    if (!has(raw, key)) {
      if (!partial && required) issues.push({ field: key, message: `${field}不能为空。` });
      return;
    }
    const t = tri(raw[key]);
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

  // 发票号码：必填，且必须是规范形态
  if (!has(raw, 'invoice_no')) {
    if (!partial) issues.push({ field: 'invoice_no', message: '发票号码不能为空。' });
  } else {
    const no = normalizeInvoiceNo(raw.invoice_no);
    if (no === null) {
      issues.push({
        field: 'invoice_no',
        message: '发票号码只能是 6–32 位数字或大写字母（全电票 20 位、纸质票 8 位）。',
      });
    } else {
      picked.invoice_no = no;
    }
  }

  if (has(raw, 'invoice_code')) {
    // 代码允许为空（全电票没有），所以不走 takeText 的 required 逻辑
    const code = normalizeInvoiceCode(raw.invoice_code);
    if (code && code.length > INVOICE_LIMITS.invoiceCode) {
      issues.push({ field: 'invoice_code', message: '发票代码最多 20 位。' });
    } else {
      picked.invoice_code = code;
    }
  }

  takeText('buyer_name', '购买方名称', INVOICE_LIMITS.partyName, true);
  takeText('seller_name', '销售方名称', INVOICE_LIMITS.partyName, true);
  takeText('remark', '备注', INVOICE_LIMITS.remark, false);

  if (has(raw, 'buyer_tax_no')) {
    const t = tri(raw.buyer_tax_no);
    if (t !== undefined) picked.buyer_tax_no = t === null ? null : normalizeTaxNo(t);
  }
  if (has(raw, 'seller_tax_no')) {
    const t = tri(raw.seller_tax_no);
    if (t !== undefined) picked.seller_tax_no = t === null ? null : normalizeTaxNo(t);
  }

  if (has(raw, 'issued_on')) {
    const t = tri(raw.issued_on);
    if (t === null) picked.issued_on = null;
    else if (t !== undefined) {
      const iso = parseIssuedOn(t);
      if (!iso) {
        issues.push({ field: 'issued_on', message: '开票日期要写成 YYYY-MM-DD，而且得是日历上真有的那一天。' });
      } else {
        picked.issued_on = iso;
      }
    }
  }

  if (has(raw, 'status')) {
    const t = tri(raw.status);
    if (t === null) {
      issues.push({ field: 'status', message: '发票状态不能为空。' });
    } else if (t !== undefined) {
      if (!isInvoiceStatus(t)) {
        issues.push({ field: 'status', message: '发票状态只能是「正常」或「冲红」。' });
      } else {
        picked.status = t;
      }
    }
  }

  // 金额三项：任一项提交了就整体重算（容差 / 推导 / 符号），
  // 只提交一项也重算，否则会出现"改了价税合计但 amount_check 还是 ok"这种假自洽
  const moneyKeys = ['amount', 'tax_amount', 'total_amount'] as const;
  const anyMoney = moneyKeys.some((k) => has(raw, k));
  if (anyMoney) {
    const parsed: InvoiceAmounts = {
      amount: null,
      taxAmount: null,
      totalAmount: null,
    };
    // 被显式清空的项（提交了 null / 空串）：推导之后要还原成 null。
    // 不还原的话，"把税额清掉"会被缺项推导立刻填回来，人看到的是"清不掉"。
    const cleared = new Set<string>();
    const slots = { amount: 'amount', tax_amount: 'taxAmount', total_amount: 'totalAmount' } as const;
    for (const k of moneyKeys) {
      if (!has(raw, k)) continue;
      const t = tri(raw[k]);
      if (t === null || t === undefined) {
        cleared.add(k);
        continue;
      }
      const money = parseOcrMoney(t);
      if (money === null) {
        issues.push({ field: k, message: '金额只能填数字（最多两位小数），可以带负号。' });
        continue;
      }
      const neg = t.trim().startsWith('-');
      parsed[slots[k]] = neg ? `-${money}` : money;
    }
    // 符号按"这次提交的 status → 库里现在的 status → normal"的顺序定。
    // 漏掉中间那一档的后果：编辑一张红票的备注时顺手改了金额，三项会被翻成正数，
    // 而 status 还是 red —— 于是合计里出现一张"状态是冲红、金额是正"的票。
    const status = isInvoiceStatus(picked.status) ? picked.status : statusFallback;
    const reconciled = reconcileAmounts(parsed);
    const signed = signAmounts(reconciled.amounts, status);
    picked.amount = cleared.has('amount') ? null : signed.amount;
    picked.tax_amount = cleared.has('tax_amount') ? null : signed.taxAmount;
    picked.total_amount = cleared.has('total_amount') ? null : signed.totalAmount;
    picked.amount_check = reconciled.check;
    if (reconciled.warning) notes.push(reconciled.warning);
    const hadNegativeInput = Object.values(parsed).some((v) => (toCents(v) ?? 0n) < 0n);
    if (hadNegativeInput && status !== 'red') {
      // 填了负数却是「正常」票：符号会被取正。这句话必须说出来，
      // 否则用户会以为"我填了负数它不认"，而账上多了一笔正数
      notes.push('金额填的是负数，但状态是「正常」，已按正数入库。要记冲红请把状态改成「冲红」（仅管理员）。');
    }
  }

  return { value: picked as Partial<ParsedInvoice>, issues, notes };
}

/* ── 判重：两张票是不是同一张（Spec §12-7）───────────────────── */

/**
 * 号码比较口径：与入库同一条规范化（全角转半角、去空白横杠、字母大写）。
 *
 * 认不出的退成大写比对：这条函数的用途是"判重"，任何一种情况下它都不该因为
 * 规范化失败就回答"不是同一张" —— 那等于给重复开一扇门。
 */
function canonInvoiceNo(v: string): string {
  return normalizeInvoiceNo(v) ?? String(v ?? '').trim().toUpperCase();
}

/**
 * 两张票是不是同一张：**号码必须相等**，且**代码相等或任一为空**。
 *
 * 为什么不能退化成"只看号码"：纸质票的 8 位号码在各省代码下会重复，只按号码判重
 * 会把别家真票当成重复吞掉 —— 而且吞得无声无息（那家的票就是录不进来，没人查得出来）。
 *
 * 为什么代码为空要放宽：空代码意味着"没认出来"或"全电票本来没有代码"，
 * 这时**无法证明它是另一张**。真实场景是重传同一张票：第一次 OCR 没认清代码存成 ''，
 * 第二次认出来了。若按全等判重，两次会被当成两张票，金额/税额/价税合计**全部虚增**，
 * 且没有任何提示 —— 而这块的全部意义就是"票不能记两遍"。
 * 宁可让用户去「已删除」里恢复那条老记录，也不能静默多记一行把合计撑大。
 *
 * 两条代码**都非空且不相等**时判为不同票：那是别家真票，必须放行。
 */
export function isSameInvoice(
  a: { code: string; no: string },
  b: { code: string; no: string },
): boolean {
  const noA = canonInvoiceNo(a.no);
  const noB = canonInvoiceNo(b.no);
  if (!noA || noA !== noB) return false;

  const codeA = normalizeInvoiceCode(a.code);
  const codeB = normalizeInvoiceCode(b.code);
  return codeA === codeB || codeA === '' || codeB === '';
}
