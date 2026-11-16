/**
 * 腾讯云《通用票据识别（高级版）》响应 → 我们的字段（纯函数，不引 SDK）。
 *
 * 为什么把映射单独拎出来：
 *   1) 这个映射**最容易写错**，而写错不报错、只出错数。文档里三处坑（Spec §5.3）：
 *      ① 全电票 20 位号码在 `Number`，不是 `ElectronicFullNumber`；
 *      ② `Date` 是中文格式 `2016年04月11日`，不能 `new Date()` 硬转；
 *      ③ 是 `SellerTaxID`（大写 ID），不是 `SellerTaxId` / `SellerTaxNo`。
 *   2) 两套结构体字段集**不同**（`VatInvoiceInfo` 有 Code，`VatElectronicInfo` 没有），
 *      必须按 SubType 分组取。一把梭 `info.Code` 会让全电票全部变成"没有代码"的脏数据。
 *   3) 纯函数才能用固定 fixture 单测到"取错字段就红"。
 *
 * 收单范围：只收增值税发票（Type ∈ {3, 16}）。火车票/机票/定额票也能识别，
 * 但本台账要的是进项发票，混进来会污染"金额合计"。
 */
import {
  applyDetectedSign,
  detectInvoiceStatus,
  normalizeInvoiceCode,
  normalizeInvoiceNo,
  normalizeTaxNo,
  normalizeText,
  parseIssuedOn,
  parseOcrMoney,
  reconcileAmounts,
  type AmountCheck,
  type InvoiceStatus,
} from './invoice-record';

/* ── SubType 分组表（务必按组取字段，不能混取）────────────────── */

/** 这些 SubType 走 `VatInvoiceInfo`：有 Code / ElectronicFullNumber */
export const VAT_INVOICE_INFO_SUBTYPES = [
  'VatSpecialInvoice',
  'VatCommonInvoice',
  'VatElectronicCommonInvoice',
  'VatElectronicSpecialInvoice',
  'VatElectronicInvoiceBlockchain',
  'VatElectronicInvoiceToll',
] as const;

/** 这些 SubType 走 `VatElectronicInfo`：**没有** Code / ElectronicFullNumber */
export const VAT_ELECTRONIC_INFO_SUBTYPES = [
  'VatElectronicInvoiceFull',
  'VatElectronicSpecialInvoiceFull',
] as const;

/** 收单的票据大类：3 增值税发票 / 16 全电发票。其余一律拒收 */
export const ACCEPTED_INVOICE_TYPES: readonly number[] = [3, 16];

export function isVatInvoiceInfoGroup(subType: string): boolean {
  return (VAT_INVOICE_INFO_SUBTYPES as readonly string[]).includes(subType);
}

export function isVatElectronicInfoGroup(subType: string): boolean {
  return (VAT_ELECTRONIC_INFO_SUBTYPES as readonly string[]).includes(subType);
}

export function isAcceptedInvoiceType(type: number | null): boolean {
  return type !== null && ACCEPTED_INVOICE_TYPES.includes(type);
}

/* ── 我们自己的响应类型（只声明用到的字段，不依赖 SDK）──────────── */

/** 结构体里的钱/票面字段，两套结构体重叠的部分 */
interface PartyInfo {
  Code?: unknown;
  Number?: unknown;
  ElectronicFullNumber?: unknown;
  Date?: unknown;
  Title?: unknown;
  Buyer?: unknown;
  BuyerTaxID?: unknown;
  Seller?: unknown;
  SellerTaxID?: unknown;
  Total?: unknown;
  PretaxAmount?: unknown;
  SubTotal?: unknown;
  Tax?: unknown;
  SubTax?: unknown;
  Remark?: unknown;
}

interface SingleInvoiceItemLike {
  [key: string]: PartyInfo | undefined;
}

export interface RecognizeItemLike {
  Code?: unknown;
  Type?: unknown;
  Page?: unknown;
  SubType?: unknown;
  SubTypeDescription?: unknown;
  TypeDescription?: unknown;
  /**
   * 文档里是 `SingleInvoiceInfos.<SubType>` 的**对象**；
   * 但线上见过数组形态，两种都要吃得下（见 `pickInfo`）。
   */
  SingleInvoiceInfos?: SingleInvoiceItemLike | SingleInvoiceItemLike[] | unknown;
}

export interface RecognizeResponseLike {
  MixedInvoiceItems?: unknown;
  TotalPDFCount?: unknown;
  RequestId?: unknown;
}

/* ── 映射结果 ─────────────────────────────────────────────── */

export interface MappedInvoice {
  invoiceNo: string;
  /** 全电票为空串（不是 null） */
  invoiceCode: string;
  /** yyyy-mm-dd；认不出为 null */
  issuedOn: string | null;
  buyerName: string;
  buyerTaxNo: string | null;
  sellerName: string;
  sellerTaxNo: string | null;
  amount: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  amountCheck: AmountCheck;
  status: InvoiceStatus;
  statusReason: string;
  /** SubType 原值，如 VatElectronicInvoiceFull */
  invoiceType: string;
  /** SubTypeDescription 原值（中文），列表直接显示 */
  invoiceTypeLabel: string;
  page: number;
  /** 与本票相关的那一段原始响应，落 ocr_raw 用 */
  raw: Record<string, unknown>;
  warnings: string[];
}

export interface MappedSkip {
  /** 42208 = 没认出来 / 不是增值税发票；41501 = 票种不支持 */
  code: 42208 | 41501;
  page: number;
  subType: string;
  type: number | null;
  /** 给日志与 ocr 统计用（英文码，不上界面） */
  reason: string;
}

export type MapOneResult =
  | { ok: true; invoice: MappedInvoice }
  | { ok: false; skip: MappedSkip };

/* ── 取值工具 ─────────────────────────────────────────────── */

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 第一个非空字符串（OCR 会给空串，也会给 null） */
function pickStr(info: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = info[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/**
 * 从 `SingleInvoiceInfos` 里挑出「这一个 SubType」对应的结构体。
 *
 * 优先按 `item.SubType` 指定的键取 —— 这一条是防串位的关键：
 * 一张图里同时有专票与全电票时，键的顺序不能决定我们读哪套字段。
 * 只有 SubType 缺失或对应键不存在时，才按分组表顺序回退。
 */
function pickInfo(
  singleInfos: unknown,
  subTypeHint: string,
): { subType: string; info: Record<string, unknown> } | null {
  const candidates: Record<string, unknown>[] = Array.isArray(singleInfos)
    ? singleInfos.map(asRec).filter((x): x is Record<string, unknown> => x !== null)
    : asRec(singleInfos)
      ? [asRec(singleInfos)!]
      : [];

  for (const container of candidates) {
    if (subTypeHint) {
      const hit = asRec(container[subTypeHint]);
      if (hit) return { subType: subTypeHint, info: hit };
    }
    for (const key of [...VAT_INVOICE_INFO_SUBTYPES, ...VAT_ELECTRONIC_INFO_SUBTYPES]) {
      const hit = asRec(container[key]);
      if (hit) return { subType: key, info: hit };
    }
  }
  return null;
}

/* ── 单张映射 ─────────────────────────────────────────────── */

/**
 * 一个 `MixedInvoiceItems[]` 元素 → 一行的入库字段。
 *
 * 拒收路径（都不落库，直接返回原因）：
 *   - `Type` 不在 {3,16} → 42208「这张不是增值税发票」（火车票 / 定额票 / 机票混不进来）
 *   - `SubType` 不在分组表里 → 41501（增值税卷票、销货清单等：能识别但不是我们要的进项票）
 *   - 号码规范化不过 → 42208（认不出号码的票入库后永远搜不到，等于占位）
 *   - 识别结果自带错误码（Code !== 'OK'）→ 42208
 */
export function mapInvoiceItem(item: unknown): MapOneResult {
  const it = asRec(item);
  const page = Number(asRec(it)?.Page ?? 0) || 1;
  const typeRaw = it?.Type;
  const type = typeof typeRaw === 'number' ? typeRaw : typeRaw === undefined ? null : Number(typeRaw);
  const subTypeHint = typeof it?.SubType === 'string' ? it.SubType : '';
  const code = typeof it?.Code === 'string' ? it.Code : '';

  if (type !== null && Number.isFinite(type) && !isAcceptedInvoiceType(type)) {
    return {
      ok: false,
      skip: { code: 42208, page, subType: subTypeHint, type, reason: 'not_vat_invoice' },
    };
  }
  if (code && code !== 'OK') {
    return { ok: false, skip: { code: 42208, page, subType: subTypeHint, type, reason: `ocr_item_${code}` } };
  }

  const picked = pickInfo(it?.SingleInvoiceInfos, subTypeHint);
  if (!picked) {
    return { ok: false, skip: { code: 42208, page, subType: subTypeHint, type, reason: 'no_invoice_info' } };
  }
  const subType = picked.subType;
  if (!isVatInvoiceInfoGroup(subType) && !isVatElectronicInfoGroup(subType)) {
    return { ok: false, skip: { code: 41501, page, subType, type, reason: 'unsupported_sub_type' } };
  }

  const info = picked.info;
  const warnings: string[] = [];

  // ① 号码：一定是 `Number`。`ElectronicFullNumber` 只是纸质全电票的辅助字段，
  //    拿它优先会把 20 位全电号换成另一串号，两张不同的票就撞成同一张。
  const rawNo = pickStr(info, 'Number') || pickStr(info, 'ElectronicFullNumber');
  const invoiceNo = normalizeInvoiceNo(rawNo);
  if (invoiceNo === null) {
    return { ok: false, skip: { code: 42208, page, subType, type, reason: 'invoice_no_unreadable' } };
  }

  // ② 代码：只有 `VatInvoiceInfo` 组有 Code；全电票存空串。
  //    这里不做"有就取"的宽容 —— 分组表已经决定了该不该有。
  const invoiceCode = isVatInvoiceInfoGroup(subType) ? normalizeInvoiceCode(pickStr(info, 'Code')) : '';

  // ③ 日期：中文字面量，走 parseIssuedOn
  const rawDate = pickStr(info, 'Date');
  const issuedOn = parseIssuedOn(rawDate);
  if (!issuedOn) {
    warnings.push(
      rawDate ? `开票日期「${normalizeText(rawDate)}」没认出格式，先空着，请在详情里补上` : '没有识别到开票日期，请在详情里补上',
    );
  }

  // ④ 双方名称与税号：字段名是 Buyer / BuyerTaxID / Seller / SellerTaxID
  const buyerName = normalizeText(pickStr(info, 'Buyer'));
  const sellerName = normalizeText(pickStr(info, 'Seller'));
  const buyerTaxNo = normalizeTaxNo(pickStr(info, 'BuyerTaxID'));
  const sellerTaxNo = normalizeTaxNo(pickStr(info, 'SellerTaxID'));

  // ⑤ 金额：不含税 = PretaxAmount（回落 SubTotal），税额 = Tax（回落 SubTax），
  //    价税合计 = Total。文档里没有 `Amount` 字段，别自己发明。
  const amountRaw = pickStr(info, 'PretaxAmount') || pickStr(info, 'SubTotal');
  const taxRaw = pickStr(info, 'Tax') || pickStr(info, 'SubTax');
  const totalRaw = pickStr(info, 'Total');

  const amount = parseOcrMoney(amountRaw);
  const taxAmount = parseOcrMoney(taxRaw);
  const totalAmount = parseOcrMoney(totalRaw);
  if (amountRaw && amount === null) warnings.push('不含税金额没认出数字，先空着');
  if (taxRaw && taxAmount === null) warnings.push('税额没认出数字，先空着');
  if (totalRaw && totalAmount === null) warnings.push('价税合计没认出数字，先空着');

  // ⑥ 红票判定要在符号归一**之前**，而且必须用**原始文本**——
  //    parseOcrMoney 只保数值、符号由 signAmounts 决定，拿清洗后的数去判永远是正数，
  //    红票会被当成正常票入账（而负号是 OCR 唯一能给出的红票线索）。
  const label = normalizeText(
    (typeof it?.SubTypeDescription === 'string' ? it.SubTypeDescription : '')
      || (typeof it?.TypeDescription === 'string' ? it.TypeDescription : ''),
  );
  const detected = detectInvoiceStatus({
    title: pickStr(info, 'Title'),
    typeLabel: label,
    amounts: { amount: amountRaw || null, taxAmount: taxRaw || null, totalAmount: totalRaw || null },
  });

  const reconciled = reconcileAmounts({ amount, taxAmount, totalAmount });
  const signed = applyDetectedSign(reconciled.amounts, detected.status);
  if (reconciled.warning) warnings.push(reconciled.warning);
  if (signed.warning) warnings.push(signed.warning);

  return {
    ok: true,
    invoice: {
      invoiceNo,
      invoiceCode,
      issuedOn,
      buyerName,
      buyerTaxNo,
      sellerName,
      sellerTaxNo,
      amount: signed.amounts.amount,
      taxAmount: signed.amounts.taxAmount,
      totalAmount: signed.amounts.totalAmount,
      amountCheck: reconciled.check,
      status: detected.status,
      statusReason: detected.reason,
      invoiceType: subType,
      invoiceTypeLabel: label || subType,
      page,
      raw: { subType, ...info },
      warnings,
    },
  };
}

export interface MapResult {
  items: MappedInvoice[];
  skipped: MappedSkip[];
  /** PDF 总页数（非 PDF 为 null） */
  totalPdfCount: number | null;
  requestId: string | null;
}

/**
 * 整份响应 → 多张票。
 *
 * 一份多页 PDF 里识别出 3 张票是常态（一次上传 = 一个 `MixedInvoiceItems` 数组），
 * 所以调用方必须按"数组"处理，不能假设一份原件只有一张票。
 */
export function mapRecognizeResult(res: unknown): MapResult {
  const root = asRec(res) as RecognizeResponseLike | null;
  const listRaw = root?.MixedInvoiceItems;
  const list = Array.isArray(listRaw) ? listRaw : [];
  const items: MappedInvoice[] = [];
  const skipped: MappedSkip[] = [];
  for (const raw of list) {
    const one = mapInvoiceItem(raw);
    if (one.ok) items.push(one.invoice);
    else skipped.push(one.skip);
  }
  const total = root?.TotalPDFCount;
  const requestId = root?.RequestId;
  return {
    items,
    skipped,
    totalPdfCount: typeof total === 'number' ? total : null,
    requestId: typeof requestId === 'string' && requestId !== '' ? requestId : null,
  };
}
