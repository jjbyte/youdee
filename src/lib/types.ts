/**
 * API 响应类型（唯一前端契约文件）。
 *
 * 与 /api/v1 实际响应对齐，键名统一为 camelCase —— 服务端返回 snake_case 时
 * 由 lib/api.ts 的 deepCamel 统一转换，页面只认这一套。
 *
 * 金额一律是**字符串**（decimal），前端不做浮点运算，只做展示。
 */
import type { TemplateLayout } from '@/domain/template-layout';

export type Role = 'admin' | 'member';
export type ItemType = 'material' | 'personnel';
export type PricingNature = 'purchase' | 'rental_per_day' | 'custom_made' | 'service';
export type UnitMode = 'per_day' | 'per_event' | 'per_person_day' | 'per_hour' | 'per_half_day';
export type SupplierType = 'online' | 'factory' | 'rental' | 'freelancer' | 'internal';
export type TaxBasis = 'inclusive' | 'exclusive';
export type CompareState = 'comparable' | 'converted' | 'not_comparable';
export type PriceEffectiveState = 'valid' | 'soft_stale' | 'hard_expired' | 'superseded' | 'archived';
export type QuoteStatus = 'draft' | 'issued' | 'void';
export type ProjectType =
  | 'annual_meeting'
  | 'product_launch'
  | 'exhibition_booth'
  | 'roadshow'
  | 'framework_client';
export type ExclusiveReason =
  | 'TAX_BASIS_MISMATCH'
  | 'UNIT_NOT_COMPARABLE'
  | 'PRICE_EXPIRED'
  | 'NATURE_MISMATCH'
  | null;

export interface Page<T> {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  items: T[];
}

export interface CurrentUser {
  id: string;
  login: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
}

// ── 分类 / 供应商 / 单位 ────────────────────────────────
export interface Category {
  id: string;
  domain: 'material' | 'personnel';
  parentId: string | null;
  name: string;
  sortOrder: number;
  defaultPricingNature: PricingNature | null;
  effectivePricingNature: PricingNature;
  itemCount?: number;
  children?: Category[];
}

export interface Supplier {
  id: string;
  name: string;
  type: SupplierType;
  contactName: string | null;
  contactPhone: string | null;
  shopUrl: string | null;
  region: string | null;
  defaultLeadTimeDays: number | null;
  note: string | null;
  /** 开票信息五项：全部可选，只在开发票时用 */
  taxNo: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  bankName: string | null;
  bankAccount: string | null;
  isActive: boolean;
  updatedAt: string;
  priceCount?: number;
  itemCount?: number;
}

// ── 主体（物料 / 人员） ─────────────────────────────────
export interface LowestSummaryGroup {
  pricingNature: PricingNature;
  pricingMode: UnitMode | null;
  groupLowest: string | null;
  unitCode: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierType: SupplierType | null;
}

export interface LowestSummary {
  isMultiGroup: boolean;
  groups: LowestSummaryGroup[];
}

export interface ItemListItem {
  id: string;
  itemType: ItemType;
  name: string;
  spec: string | null;
  /** 物料 / 人员备注：录进报价单时作为该行备注的初值 */
  note: string | null;
  baseUnitCode: string;
  baseUnitName: string;
  /** 比价单位（为空时等于基础单位）。成本单价是按它归一化的，行上的单位必须用它 */
  compareUnitCode: string | null;
  compareUnitName: string | null;
  firstImageUrl: string | null;
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  priceSupplierCount: number;
  lowestSummary: LowestSummary | null;
}

export interface ItemDetail extends ItemListItem {
  code: string | null;
  aliases: string[];
  compareUnitCode: string | null;
  compareUnitName: string | null;
  pricingMode: UnitMode | null;
  employmentType: 'internal_staff' | 'external_expert' | 'external_parttime' | null;
  includesTravel: boolean | null;
  phone: string | null;
  updatedAt: string;
  categoryPath?: Category[];
  images?: Attachment[];
  links?: ItemLink[];
  priceSummary?: {
    supplierCount: number;
    lowestSummary: LowestSummary | null;
    latestUpdatedAt: string | null;
  };
}

export interface Attachment {
  id: string;
  url: string;
  thumbUrl: string | null;
  originalName: string;
  mime: string;
  sizeBytes: number;
}

export interface ItemLink {
  id: string;
  label: string;
  url: string;
  platform: 'taobao' | 'alibaba' | 'offline' | 'other' | null;
}

// ── 比价 ───────────────────────────────────────────────
export interface CompareTier {
  minQty: string;
  maxQty: string | null;
  unitPrice: string;
  baseUnitPrice: string;
}

export interface CompareRow {
  priceId: string;
  supplierId: string;
  supplierName: string;
  supplierType: SupplierType;
  unitCode: string;
  baseUnitQty: string | null;
  qtyPriced: string;
  tierMinQty: string | null;
  tierUnitPrice: string;
  tiers: CompareTier[];
  baseUnitPrice: string;
  compareState: CompareState;
  isLowest: boolean;
  isLowestTied?: boolean;
  taxIncluded: boolean;
  effectiveState: PriceEffectiveState;
  stalenessDays: number;
  moq: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  defaultLeadTimeDays: number | null;
  sourceNote: string | null;
  /** 前端补充字段（后端未来若提供则直接用） */
  unitPriceAtQty?: string;
  deltaVsLowest?: number | null;
  exclusiveReason?: ExclusiveReason;
  tierCase?: 'in_tier' | 'above_max' | 'below_moq' | 'no_tiers' | 'gap';
  warnings?: string[];
}

export interface CompareGroup {
  pricingNature: PricingNature;
  pricingNatureLabel?: string;
  pricingMode: UnitMode | null;
  comparable: boolean;
  reason: 'MIXED_BASIS' | 'ONLY_OTHER_BASIS' | 'NO_COMPARABLE_UNIT' | 'SINGLE_ROW' | null;
  basisDimension: 'tax' | 'unit' | 'nature' | 'pricing_mode' | null;
  lowestBaseUnitPrice: string | null;
  lowestSupplierTypes?: SupplierType[];
  rows: CompareRow[];
}

export interface CompareResult {
  item: {
    id: string;
    itemType: ItemType;
    name: string;
    baseUnitCode: string;
    baseUnitName: string;
    compareUnitCode: string | null;
    compareUnitName: string | null;
  };
  qty: string;
  onDate: string;
  tierBreakpoints: number[];
  groups: CompareGroup[];
  missingSuppliers?: Array<{
    supplierId: string;
    supplierName: string;
    supplierType: SupplierType;
    reason: 'NO_VALID_PRICE';
  }>;
}

export interface PriceTrendPoint {
  effectiveFrom: string;
  effectiveTo: string | null;
  tierMinQty: string | null;
  tierUnitPrice: string;
  baseUnitPrice: string;
  unitCode: string;
}

export interface PriceTrend {
  itemId: string;
  itemName: string;
  baseUnitCode: string;
  series: Array<{
    supplierId: string;
    supplierName: string;
    supplierType: SupplierType;
    points: PriceTrendPoint[];
  }>;
}

// ── 取价 ───────────────────────────────────────────────
export interface PriceLookupResult {
  itemId: string;
  itemType: ItemType;
  itemName: string;
  itemSpec: string | null;
  baseUnitCode: string;
  baseUnitName: string;
  qty: string;
  pricingNature: PricingNature;
  qtyPriced: string;
  onDate: string;
  resolvedFrom: {
    priceId: string;
    supplierId: string;
    supplierName: string;
    supplierType: SupplierType;
    unitCode: string;
    baseUnitQty: string | null;
    tierMinQty: string | null;
    tierUnitPrice: string;
    taxIncluded: boolean;
    effectiveState: PriceEffectiveState;
    stalenessDays: number;
    moq: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceNote: string | null;
  };
  baseUnitPrice: string;
  moqWarning: boolean;
  tierBelowMin: boolean;
}

/** 42205 错误体 data：另一口径的提示信息，只能用于提示，绝不回填成本 */
export interface PriceLookupMiss {
  itemId: string;
  supplierId: string | null;
  pricingNature: PricingNature;
  taxBasis: TaxBasis;
  onDate: string;
  otherBasisExists: boolean;
  otherBasisTaxIncluded: boolean | null;
  otherBasisPrice: string | null;
  otherBasisPriceId: string | null;
}

// ── 价格条目 ───────────────────────────────────────────
export interface Price {
  id: string;
  itemId: string;
  itemType: ItemType;
  itemName: string;
  baseUnitCode: string;
  baseUnitName: string;
  supplierId: string;
  supplierName: string;
  supplierType: SupplierType;
  unitCode: string;
  baseUnitQty: string | null;
  pricingNature: PricingNature;
  unitMode: UnitMode | null;
  unitPrice: string;
  taxIncluded: boolean;
  moq: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'active' | 'superseded' | 'archived';
  effectiveState: PriceEffectiveState;
  stalenessDays: number;
  sourceNote: string | null;
  tiers: CompareTier[];
  previousClosedId?: string | null;
}

// ── 报价单 ─────────────────────────────────────────────
export interface QuoteTotals {
  totalCost: string;
  totalPrice: string;
  discountAmount: string;
  totalProfit: string;
  marginRate: string | null;
  minLineMargin: string | null;
}

export interface QuoteListItem extends QuoteTotals {
  id: string;
  quoteNo: string;
  version: number;
  customerName: string;
  eventName: string;
  eventDate: string | null;
  projectType: ProjectType | null;
  warnRateUsed: string | null;
  warnRateSource: 'project_type' | 'global_default';
  validUntil: string;
  status: QuoteStatus;
  isExpired: boolean;
  itemCount: number;
  createdByName: string | null;
  /** 报价人电话：客户版抬头用；账号没填就是 null（抬头不显示这一格） */
  createdByPhone: string | null;
  createdAt: string;
  /** 列表接口未返回时前端退回 createdAt */
  updatedAt?: string;
  issuedAt: string | null;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  lineKind: 'material' | 'personnel' | 'custom';
  pricingNature: PricingNature | null;
  sortOrder: number;
  itemNameSnapshot: string;
  specSnapshot: string | null;
  categorySnapshot: string | null;
  unitSnapshot: string;
  qty: string;
  costUnitPrice: string | null;
  costSource: 'price_book' | 'manual';
  referenceLowestPrice: string | null;
  referenceLowestSupplierId: string | null;
  saleUnitPrice: string;
  itemId: string | null;
  supplierId: string | null;
  supplierNameSnapshot: string | null;
  priceId: string | null;
  isVisibleToCustomer: boolean;
  remark: string | null;
  lineCost: string;
  linePrice: string;
  lineProfit: string;
  lineMargin: string | null;
  priceMissing: boolean;
}

export interface QuoteDetail extends QuoteListItem {
  derivedFromQuoteId: string | null;
  targetMarginRate: string | null;
  currency: string;
  taxStatement: TaxBasis;
  note: string | null;
  updatedAt: string;
  items: QuoteItem[];
  /** 建单时选的模板（追溯用） */
  templateId: string | null;
  /** 快照：抬头印的供应商名称。改模板不会改这个值 */
  templateSupplierName: string | null;
  /** 快照：版式（列序 / 表头 / 抬头排布）。null = 系统默认版式 */
  templateLayout: TemplateLayout | null;
  /** 报价日期 = 建单日（yyyy-mm-dd），和活动日期不是一回事 */
  quoteDate: string;
}

/** 报价单模板：一套固定的抬头配置，建单时选一个 */
export interface QuoteTemplate {
  id: string;
  name: string;
  /** 印在客户版抬头的供应商名称 */
  supplierName: string;
  /** Excel 解析出的版式；null = 系统默认版式 */
  layout: TemplateLayout | null;
  /** 上传的原始 xlsx 路径（存档用） */
  sourceFile: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RiskCheckResult {
  priceExpiring: Array<{
    itemId: string | null;
    itemNameSnapshot: string;
    supplierNameSnapshot: string | null;
    effectiveTo: string;
    lineIndexes?: number[];
  }>;
  negativeMarginItems: Array<{
    itemId: string | null;
    itemNameSnapshot: string;
    linePrice: string;
    lineCost: string;
    lineProfit: string;
    lineIndexes?: number[];
  }>;
  zeroPriceItems: Array<{
    itemId: string | null;
    itemNameSnapshot: string;
    priceMissing: boolean;
    lineIndexes?: number[];
  }>;
  staleDraftItems: Array<{
    itemId: string | null;
    itemNameSnapshot: string;
    snapshotPrice: string;
    latestPrice: string | null;
    lineIndexes?: number[];
  }>;
  validUntilPassed: boolean;
  /** 与 domain RiskFinding 同构。界面主要用上面四个分组数组渲染，
   *  这两个是"原始清单"，留着是为了将来做"导出核对表"时不丢条目。 */
  blockers: Array<{
    code: string;
    level: 'blocker' | 'warning';
    title: string;
    detail: string;
    lineIndexes: number[];
  }>;
  warnings: Array<{
    code: string;
    level: 'blocker' | 'warning';
    title: string;
    detail: string;
    lineIndexes: number[];
  }>;
  blockerCount: number;
  warningCount: number;
  warnRateUsed: string;
  warnRateSource: 'project_type' | 'global_default';
}

export interface QuoteSettings {
  staleDaysThreshold: number;
  defaultMarginThreshold: string;
  marginThresholds: Array<{
    projectType: ProjectType;
    label?: string;
    warnRate: string;
    /** 该类型的默认毛利率；null = 没配，建单时不预填 */
    defaultMarginRate?: string | null;
  }>;
  taxStatementDefault: TaxBasis;
  defaultTerms: string | null;
  /** 报价有效期天数：新建单按「今天 + N 天」预填有效期，改它不动已建好的单 */
  validDays: number;
}

export interface CompanyProfile {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNo: string | null;
  bankInfo: string | null;
}

/**
 * 对象存储设置（腾讯云 COS）。
 *
 * 注意 `secretKeySet` / `secretKeyHint`：服务端**不回传密钥原文**，
 * 界面只能显示"已配置 ••••1234"。所以输入框留空 = 不改。
 */
export interface StorageSettings {
  /** 当前实际生效：配置完整且启用才是 cos */
  provider: 'local' | 'cos';
  status: 'local' | 'cos' | 'cos_incomplete' | 'cos_disabled';
  cos: {
    enabled: boolean;
    secretId: string;
    secretKeySet: boolean;
    secretKeyHint: string;
    bucket: string;
    region: string;
    keyPrefix: string;
    customDomain: string | null;
  };
}

export interface UserRecord {
  id: string;
  /** 登录名。内部账号没有邮箱，别把它当 email 用 */
  login: string;
  name: string;
  role: Role;
  /** 报价单抬头给客户看的电话；空 = 抬头不显示电话这一格 */
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ── 工作台 ─────────────────────────────────────────────
export interface DashboardSummary {
  materialCount: number;
  personnelCount: number;
  supplierCount: number;
  priceCount: number;
  expiringPriceCount: number;
  draftQuoteCount: number;
  monthQuoteTotal: string;
  recentQuotes: QuoteListItem[];
  unreadNotificationCount: number;
  stalePriceCount: number;
  manualCostLineRatio: string | null;
  hasOverduePrice: boolean;
  overduePriceCount?: number;
  /**
   * 周期性合同的到期提醒（**仅管理员有**，成员拿不到这个字段）。
   * 判据是合同上填了终止日期，且终止日期在今天 + 30 天以内——已过期的不放过，
   * 那正是最需要有人去续签的时候。
   */
  expiringContracts?: {
    total: number;
    /** 其中已经过了终止日期的 */
    expired: number;
    items: Array<{
      id: string;
      title: string;
      contractNo: string | null;
      customerName: string | null;
      endOn: string;
      /** 负数 = 已过期 */
      daysLeft: number;
    }>;
  };
  stalePrices?: Array<{
    itemId: string;
    itemName: string;
    supplierName: string;
    stalenessDays: number;
    effectiveTo: string | null;
    unitPrice: string;
    unitCode: string;
  }>;
  recentPriceChanges: Array<{
    priceId: string;
    itemName: string;
    supplierName: string;
    action: 'created' | 'superseded' | 'archived' | 'manual';
    changedByName: string | null;
    changedAt: string;
    isOverwrite: boolean;
    oldPrice?: string | null;
    newPrice?: string | null;
  }>;
  favoriteItems?: ItemListItem[];
}

// ── 合同管理 ────────────────────────────────────────────────

/** 合同附件的三个抽屉 */
export type ContractFileCategory = 'contract' | 'quote' | 'settlement';

/** 合同分类：与 src/domain/contract.ts 的 CONTRACT_CATEGORIES 一一对应 */
export type ContractCategory = 'commercial' | 'lease' | 'employment';

/**
 * 合同状态：直接复用 `src/domain/contract.ts` 的枚举类型，前端不另写一份 union。
 * 两处各写一份，加第六个状态时必然一边改一边忘，而忘的那一边会静默把新状态当默认值。
 */
import type { ContractStatus } from '@/domain/contract';
export type { ContractStatus };

/** 合同附件（PDF / 图片 / Word / Excel）。一个合同可挂多份，按 category 分组 */
export interface ContractFile {
  id: string;
  kind: string;
  category: ContractFileCategory;
  /** local 本地磁盘 / cos 腾讯云对象存储；只影响 url 的形态，界面不用分支 */
  storage: 'local' | 'cos';
  /** 浏览器可直接点的地址（cos 文件是后端签名跳转路由） */
  url: string;
  originalName: string;
  mime: string;
  /** 服务端判定的真实扩展名：pdf/jpg/png/webp/doc/docx/xls/xlsx */
  ext: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: string;
}

/**
 * Excel 附件的预览数据。服务端只给值和行列位置，不给格式 ——
 * 合并单元格、颜色、图表都不还原，目的是"核对金额和条款"，不是还原原文。
 */
export interface SheetPreview {
  name: string;
  /** 已按行补齐到同一列数的二维字符串 */
  rows: string[][];
  /** 截断前的真实行列数，用来告诉用户"后面还有" */
  totalRows: number;
  totalCols: number;
  truncated: boolean;
}

/** 合同关联的系统报价单 */
export interface ContractQuote {
  id: string;
  quoteNo: string;
  version: number;
  customerName: string;
  eventName: string;
  status: 'draft' | 'issued' | 'void';
  totalPrice: string;
  issuedAt: string | null;
  /** 报价单被软删：关联还在，但界面上要标灰 */
  deleted: boolean;
}

/** 合同台账的一行。金额是字符串（numeric 原样传，避免浮点丢精度） */
export interface Contract {
  id: string;
  contractNo: string | null;
  title: string;
  /** 公司名称（甲方 = 我方签约主体） */
  companyName: string;
  /** 客户名称（乙方）；老数据可能为空 */
  customerName: string | null;
  projectName: string | null;
  /** 商业 / 租赁 / 雇佣 */
  category: ContractCategory;
  /** 签订中 / 履约中 / 结算中 / 已结算 / 已终止。任意切换，只有 PATCH /contracts/:id/status 能写 */
  status: ContractStatus;
  /** yyyy-mm-dd；未知时为 null（不拿建单日冒充） */
  signedOn: string | null;
  /**
   * 终止日期 yyyy-mm-dd。**有值就是周期性合同**（年 / 季度续签那类），
   * 到期前一个月会出现在工作台的待处理里。
   */
  endOn: string | null;
  amount: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** 非空 = 已软删，只有管理员看得到 */
  deletedAt: string | null;
  /** 三个抽屉相加 */
  fileCount: number;
  fileCounts: { contract: number; quote: number; settlement: number };
  /** 关联的系统报价单张数 */
  quoteCount: number;
}

export interface ContractDetail extends Contract {
  files: ContractFile[];
  quotes: ContractQuote[];
}

// ── 发票台账 ─────────────────────────────────────────────────

/** 正常 / 已冲红。冲红不是"作废"，是「这张蓝票已经被一张红字票冲掉了」 */
export type InvoiceStatus = 'normal' | 'red';

/** 状态怎么来的：ocr 自动判定 / manual 人工改过（人工改过的不再被重传覆盖） */
export type InvoiceStatusSource = 'ocr' | 'manual';

/** 三项金额自洽性：ok / derived（由另两项推算）/ mismatch（差 > 0.01 元，界面标黄） */
export type InvoiceAmountCheck = 'ok' | 'derived' | 'mismatch';

/** 发票台账的一行。三个金额是字符串，**前端不做浮点运算** */
export interface InvoiceListItem {
  id: string;
  /** 全电 20 位 / 纸质 8 位 */
  invoiceNo: string;
  /** 纸质票 10/12 位；全电票为空串（不是 null） */
  invoiceCode: string;
  status: InvoiceStatus;
  statusSource: InvoiceStatusSource;
  /**
   * 票面就是红字票（红冲票）：三项金额为负。
   *
   * 与 `status` 是两件事：红字票自己的状态仍是「正常」（它是一张正常凭证），
   * 被它冲掉的那张蓝票才是「已冲红」。两列分开，一对票在合计里才能抵成 0。
   */
  isRedLetter: boolean;
  /** 红字票冲的是哪一张（票面「被红冲蓝字数电发票号码 / 对应正数发票号码」） */
  originalInvoiceNo: string | null;
  /** OCR 的 SubType 原值，如 VatElectronicInvoiceFull */
  invoiceType: string;
  /** 票种中文，直接显示，前端不维护映射表 */
  invoiceTypeLabel: string;
  /** yyyy-mm-dd；认不出时为 null（不拿上传日冒充） */
  issuedOn: string | null;
  buyerName: string;
  buyerTaxNo: string | null;
  sellerName: string;
  sellerTaxNo: string | null;
  /** 不含税金额。冲红为负；没认出来就是 null（不是 0） */
  amount: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  amountCheck: InvoiceAmountCheck;
  remark: string | null;
  fileCount: number;
  /** 关联合同数 */
  contractCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * 列表统计（与 items 同一套查询条件、一次扫描出来的）。
 * 金额是「非空求和」，缺金额的另给张数——写成 0 会让合计悄悄少算。
 */
export interface InvoiceSummary {
  count: number;
  sumAmount: string;
  sumTaxAmount: string;
  sumTotalAmount: string;
  /** 三列任一为空的行数 */
  missingAmountCount: number;
  /** 命中范围内冲红张数。缺这个字段时界面不显示「含冲红」那一格 */
  /**
   * 命中范围内的冲红张数。**必现**（无冲红时是 0，不是缺字段）——
   * 冲红行金额记负、会翻合计的符号，这个数字相当于给合计配的一句注释，
   * 缺了它用户就只能怀疑合计算错了。
   */
  redCount: number;
}

export interface InvoicePage extends Page<InvoiceListItem> {
  summary: InvoiceSummary;
}

/** 发票原件。一个发票可挂多份；同一份物理文件可被多行引用（多页 PDF） */
export interface InvoiceFile {
  id: string;
  storage: 'local' | 'cos';
  /** 浏览器可直接点的地址（云存储是后端的签名跳转） */
  url: string;
  originalName: string;
  /** 只收 application/pdf、image/jpeg、image/png */
  mime: string;
  /** 服务端按字节判定的真实扩展名：pdf / jpg / png。决定能不能在页面里看 */
  ext: string;
  sizeBytes: number;
  createdAt: string;
}

/** 发票上挂着的合同（发票侧只读，解除关联在这里做） */
export interface InvoiceLinkedContract {
  id: string;
  contractNo: string | null;
  title: string;
  companyName: string;
  status: ContractStatus | null;
  /** 合同已被软删：关联还在，界面标灰 */
  deleted: boolean;
}

export interface InvoiceDetail extends InvoiceListItem {
  files: InvoiceFile[];
  contracts: InvoiceLinkedContract[];
}

/** 合同侧看到的发票摘要（合同抽屉、发票 picker 用） */
export interface InvoiceBrief {
  id: string;
  invoiceNo: string;
  invoiceCode: string;
  issuedOn: string | null;
  sellerName: string;
  buyerName: string;
  totalAmount: string | null;
  status: InvoiceStatus;
  /**
   * 票面是红字票：界面「状态」显示「红字票」，盖过 status 的「正常」。
   * 与发票台账那一列是同一个字段，合同抽屉不该有另一套说法。
   */
  isRedLetter: boolean;
  /** 发票已被软删：关联保留，界面标灰并提示可恢复 */
  deleted: boolean;
}

/** 同一份文件里还识别出的其它票（多页 PDF / 混贴） */
export interface InvoiceUploadExtra {
  invoiceNo: string;
  totalAmount: string | null;
  page: number;
  saved: boolean;
  reason?: string;
}

/**
 * 上传时识别出一张红字票，而它冲的那张原票就在系统里（在用、仍为「正常」）。
 *
 * 红字票本身**已经入账**（金额为负、状态正常），这里问的只是：要不要顺手把
 * 原票标成「已冲红」。标不标都不影响合计——负数是红字票那行带来的。
 * 服务端**不会自动改**，因为「谁冲了谁」是从票面文字里读出来的，读错就把别人的票改脏了。
 */
export interface InvoiceUploadRedHint {
  /** 待标记的那张原票 */
  invoiceId: string;
  invoiceNo: string;
  totalAmount: string | null;
  currentStatus: InvoiceStatus;
  /** 冲它的那张红字票（这次上传的） */
  redInvoiceNo: string;
  redTotalAmount: string | null;
  /** 判定依据（人话）：票面金额是负数 / 票面有「红字」字样 */
  basis: string;
}

export interface InvoiceUploadResult {
  /** 落库的那张（duplicated 时是已存在的那张） */
  item: InvoiceDetail;
  /** true = 票号已存在，本次未新建 */
  duplicated: boolean;
  /** true = 命中去重但该票原先没原件，已把这份原件补上 */
  attachedFile: boolean;
  extraItems: InvoiceUploadExtra[];
  /** 需要人确认「要不要把已有那张标成冲红」的候选，通常为空 */
  redHints: InvoiceUploadRedHint[];
  /** 例：'金额三项差 0.02 元，已标黄' */
  warnings: string[];
}

/**
 * 发票识别（腾讯云 OCR）设置。
 * 服务端**永不回传 secretKey 原文**，只给「配没配 + 末四位」，所以输入框留空 = 不改。
 */
export interface OcrSettings {
  enabled: boolean;
  secretId: string;
  secretKeySet: boolean;
  secretKeyHint: string;
  region: string;
}
