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
 * 收单范围：只收增值税发票、全电发票（Type 3 / 16），外加 **电子发票（铁路电子客票）**
 * —— 它也是 Type 16（全电票大类），但字段集与全电发票完全不同，走单独的映射分支。
 *
 * 纸质火车票、机票行程单、定额发票、出租车票这些不是发票（是报销凭证），仍然拒收：
 * 混进来会污染"金额合计"，而合计正是这张台账唯一要保证对的数。
 */
import {
  applyDetectedSign,
  detectRedLetter,
  normalizeInvoiceCode,
  normalizeInvoiceNo,
  normalizeTaxNo,
  normalizeText,
  parseIssuedOn,
  parseOcrMoney,
  reconcileAmounts,
  toCents,
  type AmountCheck,
} from './invoice-record';
import { ORIGINAL_INVOICE_KEYS, extractOriginalInvoiceNo } from './invoice-red-letter';
import { fmtAmount } from './money';

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

/**
 * 电子发票（铁路电子客票）的 SubType。
 *
 * 它属于 Type 16（全电票大类），但 **`SingleInvoiceInfos.ElectronicTrainTicketFull`
 * 是另一个结构体**：没有 `Code`、没有 `Seller`、`Fare` 与 `Total` 是两个不同的数。
 * 所以不能塞进 `VAT_ELECTRONIC_INFO_SUBTYPES` 了事 —— 那样取出来的字段会全错。
 */
export const RAIL_TICKET_SUBTYPE = 'ElectronicTrainTicketFull';

/**
 * 铁路电子客票的销售方。
 *
 * 这个结构体里**没有 Seller 字段**（票面只印「购买方信息」和开票人），
 * 而台账里销售方是必填的（空着就不知道钱付给谁了）。
 * 中国铁路的电子客票统一由中国国家铁路集团有限公司（原中国铁路总公司）作为
 * 开票主体，所以这里给一个固定值，界面上可以在抽屉里改。
 */
export const RAIL_SELLER_NAME = '中国铁路集团有限公司';

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
  /**
   * 票面是红字票（红冲票）。
   *
   * **不是 `status`**：红字票入账后的账面状态是「正常」（它本身就是一张正常凭证），
   * 被它冲掉的那张蓝票才标「已冲红」。这里回答的是"金额该记正还是记负"。
   */
  redLetter: boolean;
  /** 判定依据（amount_negative / title_red / heuristic_normal） */
  statusReason: string;
  /** 红字票冲的原票号码（票面「被红冲蓝字数电发票号码」等字样读出来的） */
  originalInvoiceNo: string | null;
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
  /** 42208 = 没认出来 / 不是发票；41501 = 票种不支持（能认出但不是台账收的） */
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
    // 兜底扫描要连铁路客票一起看：SubType 偶发缺失时，只按增值税那两组找
    // 会把一张铁路票判成「没认出票据信息」。
    for (const key of [...VAT_INVOICE_INFO_SUBTYPES, ...VAT_ELECTRONIC_INFO_SUBTYPES, RAIL_TICKET_SUBTYPE]) {
      const hit = asRec(container[key]);
      if (hit) return { subType: key, info: hit };
    }
  }
  return null;
}

/* ── 单张映射 ─────────────────────────────────────────────── */


/**
 * 红字票冲的是哪一张。
 *
 * 查找顺序是**先结构化字段、再备注、最后整段兜底**：
 *   - 腾讯云对红字票没有稳定字段（各票种各叫一个名），`ORIGINAL_INVOICE_KEYS` 只是先试一遍；
 *   - 真正的信息一般写在 `Remark`：「被红冲蓝字数电发票号码：xxxx」；
 *   - 兜底把那一段信息里所有字符串拼起来再找一遍：字段名猜错时不至于永远返回 null。
 *
 * 认错一个号码的代价是"提示用户把另一张无辜的票标成已冲红"，所以这里
 * **只认显式标签 + 号码**（见 invoice-red-letter），不在没有标签的文本里乱抓 20 位数字。
 */
function readOriginalInvoiceNo(info: Record<string, unknown>, redLetter: boolean): string | null {
  if (!redLetter) return null;
  const structured = ORIGINAL_INVOICE_KEYS.map((k) => (typeof info[k] === 'string' ? (info[k] as string) : null));
  const remark = typeof info.Remark === 'string' ? info.Remark : null;
  const allStrings = Object.values(info).filter((v): v is string => typeof v === 'string');
  const hit = extractOriginalInvoiceNo([...structured, remark, ...allStrings]);
  return hit.invoiceNo;
}

/* ── 铁路电子客票（Type 16 的另一套字段）──────────────────────── */

/** 含税合计 − 税额 = 不含税金额；任一缺失返回 null（不猜） */
function subtractMoney(total: string | null, tax: string | null): string | null {
  const t = toCents(total);
  const x = toCents(tax);
  if (t === null || x === null) return null;
  const diff = t - x;
  return diff < 0n ? null : fmtAmount(diff);
}

/**
 * `ElectronicTrainTicketFull`（电子发票·铁路电子客票）→ 一行的入库字段。
 *
 * 与增值税那条路的四处不同，每一处都能让数算错：
 *   1. **`Fare` 是含税票价，`Total` 是金额**。票面上乘客看到的「票价」已经含着税额，
 *      拿 `Total` 当价税合计会让合计少算一张票的税额；反过来拿 `Fare` 当不含税
 *      会让合计多算一次税。所以：价税合计取 `Fare`，不含税取 `Total`（没有就用
 *      `Fare − Tax` 推），三个数再交给 `reconcileAmounts` 自校验。
 *   2. **结构体里没有 `Seller`**：票面只印购买方与开票人。销售方按铁路的
 *      统一开票主体落库（`RAIL_SELLER_NAME`），入账后可以在抽屉里改。
 *   3. **没有 `Code`**：铁路电子客票是 20 位全电号码，代码存空串，
 *      与全电票共用同一条判重口径（代码为空时按号码匹配）。
 *   4. 没有 `PretaxAmount` / `SubTotal` / `Title`，日期字段叫 `Date`（开票日期），
 *      不是 `DateGetOn`（乘车日期）—— 后者是行程时间，拿它当开票日期会让
 *      「按开票日期查」这一整列错位。
 */
function mapRailInvoice(args: {
  info: Record<string, unknown>;
  page: number;
  subType: string;
  type: number | null;
  label: string;
}): MapOneResult {
  const { info, page, subType, type, label } = args;
  const warnings: string[] = [];

  const invoiceNo = normalizeInvoiceNo(pickStr(info, 'Number'));
  if (invoiceNo === null) {
    return { ok: false, skip: { code: 42208, page, subType, type, reason: 'invoice_no_unreadable' } };
  }

  const rawDate = pickStr(info, 'Date');
  const issuedOn = parseIssuedOn(rawDate);
  if (!issuedOn) {
    warnings.push(
      rawDate
        ? `开票日期「${normalizeText(rawDate)}」没认出格式，先空着，请在详情里补上`
        : '没有识别到开票日期，请在详情里补上',
    );
  }

  const buyerName = normalizeText(pickStr(info, 'Buyer'));
  const buyerTaxNo = normalizeTaxNo(pickStr(info, 'BuyerTaxID'));

  const fareRaw = pickStr(info, 'Fare');
  const totalRaw = pickStr(info, 'Total');
  const taxRaw = pickStr(info, 'Tax');

  const fare = parseOcrMoney(fareRaw);
  const pretaxField = parseOcrMoney(totalRaw);
  const taxAmount = parseOcrMoney(taxRaw);

  // 票价优先（含税）。票价缺失才退回「金额」字段——那种情况下这个数到底是含税
  // 还是不含税，接口没说清，所以只在没有票价时用，并留一条提示让人核对。
  const totalAmount = fare ?? pretaxField;
  if (!fare && pretaxField) warnings.push('没有票价字段，价税合计暂用「金额」，请核对一下是不是含税数');

  const amount =
    pretaxField !== null && (fare === null || pretaxField !== fare)
      ? pretaxField
      : subtractMoney(totalAmount, taxAmount);
  if (totalAmount && taxAmount && amount === null) {
    warnings.push('票价小于税额，不含税金额先空着，请核对');
  }

  const detected = detectRedLetter({
    title: pickStr(info, 'TypeOfVoucher'),
    typeLabel: label,
    remark: pickStr(info, 'Remark'),
    amounts: { amount: null, taxAmount: taxRaw || null, totalAmount: (fareRaw || totalRaw) || null },
  });

  const reconciled = reconcileAmounts({ amount, taxAmount, totalAmount });
  const signed = applyDetectedSign(reconciled.amounts, detected.redLetter);
  if (reconciled.warning) warnings.push(reconciled.warning);
  if (signed.warning) warnings.push(signed.warning);

  return {
    ok: true,
    invoice: {
      invoiceNo,
      invoiceCode: '',
      issuedOn,
      buyerName,
      buyerTaxNo,
      sellerName: RAIL_SELLER_NAME,
      sellerTaxNo: null,
      amount: signed.amounts.amount,
      taxAmount: signed.amounts.taxAmount,
      totalAmount: signed.amounts.totalAmount,
      amountCheck: reconciled.check,
      redLetter: detected.redLetter,
      statusReason: detected.reason,
      // 铁路客票目前没有红字版式（退票是另一张客票），不读原票号码
      originalInvoiceNo: null,
      invoiceType: subType,
      invoiceTypeLabel: label || '电子发票（铁路电子客票）',
      page,
      raw: { subType, ...info },
      warnings,
    },
  };
}

/**
 * 一个 `MixedInvoiceItems[]` 元素 → 一行的入库字段。
 *
 * 拒收路径（都不落库，直接返回原因）：
 *   - `Type` 不在 {3,16} → 42208「这张不是发票」（纸质火车票 / 定额票 / 出租车票混不进来）
 *   - `SubType` 既不是增值税两组、也不是铁路电子客票 → 41501（增值税卷票、销货清单、
 *     航空运输电子客票行程单等：能识别，但不是本台账收的票种）
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
  const info = picked.info;

  /**
   * 票种中文名。放在这里是因为红票判定与铁路客票分支都要用它，
   * 而两处必须是**同一个值** —— 各算一遍早晚会分叉。
   */
  const label = normalizeText(
    (typeof it?.SubTypeDescription === 'string' ? it.SubTypeDescription : '')
      || (typeof it?.TypeDescription === 'string' ? it.TypeDescription : ''),
  );

  /*
   * 铁路电子客票必须在分组校验**之前**分出去：它是 Type 16，但既不属于
   * `VatInvoiceInfo` 也不属于 `VatElectronicInfo`，落到下面那道校验里会被
   * 当成"不支持的子票种"拒掉（41501）—— 而那正是上一版收不到铁路票的原因。
   */
  if (subType === RAIL_TICKET_SUBTYPE) {
    return mapRailInvoice({ info, page, subType, type, label });
  }

  if (!isVatInvoiceInfoGroup(subType) && !isVatElectronicInfoGroup(subType)) {
    return { ok: false, skip: { code: 41501, page, subType, type, reason: 'unsupported_sub_type' } };
  }

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
  const detected = detectRedLetter({
    title: pickStr(info, 'Title'),
    typeLabel: label,
    // 红字发票的红冲信息常常只写在备注里（标题仍叫「电子发票（普通发票）」）
    remark: pickStr(info, 'Remark'),
    amounts: { amount: amountRaw || null, taxAmount: taxRaw || null, totalAmount: totalRaw || null },
  });

  const reconciled = reconcileAmounts({ amount, taxAmount, totalAmount });
  const signed = applyDetectedSign(reconciled.amounts, detected.redLetter);
  if (reconciled.warning) warnings.push(reconciled.warning);
  if (signed.warning) warnings.push(signed.warning);

  /*
   * 红字票的原票号码：认不出来不算失败（票还是照记，负数照样抵账），
   * 但要提醒一句——没有它就是"不知道这张冲的是哪一张"，那笔原票会一直显示「正常」。
   */
  const originalInvoiceNo = readOriginalInvoiceNo(info, detected.redLetter);
  if (detected.redLetter && !originalInvoiceNo) {
    warnings.push('这张像红字票，但票面上没读出「被红冲蓝字发票号码 / 原发票号码」，记完请手动对一下原票');
  }

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
      redLetter: detected.redLetter,
      statusReason: detected.reason,
      originalInvoiceNo,
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
