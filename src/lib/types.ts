/**
 * API 响应类型（唯一前端契约文件）。
 *
 * 与 docs/openapi.yaml 对齐，但键名统一为 camelCase —— 服务端返回 snake_case 时
 * 由 lib/api.ts 的 deepCamel 统一转换，页面只认这一套。
 *
 * 金额一律是**字符串**（decimal），前端不做浮点运算，只做展示。
 */

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
  baseUnitCode: string;
  baseUnitName: string;
  firstImageUrl: string | null;
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  priceSupplierCount: number;
  lowestSummary: LowestSummary | null;
}

export interface ItemDetail extends ItemListItem {
  code: string | null;
  compareUnitCode: string | null;
  compareUnitName: string | null;
  pricingMode: UnitMode | null;
  employmentType: 'internal_staff' | 'external_expert' | 'external_parttime' | null;
  includesTravel: boolean | null;
  phone: string | null;
  note: string | null;
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
  createdAt: string;
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
  /** 兼容：服务端若给统一 findings 清单，直接渲染 */
  findings?: Array<{
    level: 'blocker' | 'warning';
    code: string;
    message: string;
    lineIndexes?: number[];
  }>;
}

export interface QuoteSettings {
  staleDaysThreshold: number;
  defaultMarginThreshold: string;
  marginThresholds: Array<{ projectType: ProjectType; label?: string; warnRate: string }>;
  taxStatementDefault: TaxBasis;
  defaultTerms: string | null;
}

export interface CompanyProfile {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNo: string | null;
  bankInfo: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
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
