/**
 * 单位与计价口径。
 *
 * 关键区分（Spec §6.3）：
 *   unit_code —— 「单位本身」，落库、可写。如 sqm / sheet / day / session
 *   unit_mode —— 「按什么计价」，数据库生成列、只读、只用于分组与唯一键。
 *                只有时间类单位有值，其余一律 NULL。
 *
 * 为什么非时间单位必须归并为 NULL：sqm 与 sheet 是**同一个价的两种写法**。
 * 若 unit_mode 派生为 per_sqm / per_sheet，EXCLUDE 会允许"同供应商同时存在
 * ㎡价与张价"，resolvePrice 就得在两条里挑一条 —— 取价变成不可预期。
 * 正确做法是同一条价填 base_unit_qty 折算，而不是加维度。
 */

export const UNIT_CODES = [
  // 通用/物料
  'piece', 'case', 'block', 'sheet', 'set', 'group', 'sqm',
  'linear_m', 'meter', 'day', 'session', 'batch', 'root', 'roll',
  // 人员
  'person_day', 'hour', 'half_day',
] as const;

export type UnitCode = (typeof UNIT_CODES)[number];

/** unit_code → unit_mode。时间类之外一律 null（不可派生） */
const UNIT_MODE_MAP: Record<string, UnitMode> = {
  day: 'per_day',
  session: 'per_event',
  person_day: 'per_person_day',
  hour: 'per_hour',
  half_day: 'per_half_day',
};

export const UNIT_MODES = [
  'per_day', 'per_event', 'per_person_day', 'per_hour', 'per_half_day',
] as const;

export type UnitMode = (typeof UNIT_MODES)[number];

/** 与数据库生成列完全同源的派生函数（前端展示用，绝不用于写库） */
export function unitModeOf(unitCode: string | null | undefined): UnitMode | null {
  if (!unitCode) return null;
  return UNIT_MODE_MAP[unitCode] ?? null;
}

export function isTimeUnit(unitCode: string): boolean {
  return unitModeOf(unitCode) !== null;
}

/** 单位中文名（展示用；权威字典在 units 表） */
export const UNIT_LABELS: Record<string, string> = {
  piece: '个', case: '件', block: '块', sheet: '张', set: '套', group: '组',
  sqm: '㎡', linear_m: '延米', meter: 'm', day: '天', session: '场',
  batch: '批', root: '根', roll: '卷', person_day: '人天', hour: '小时', half_day: '半天',
};

export const UNIT_MODE_LABELS: Record<UnitMode, string> = {
  per_day: '按天', per_event: '按场', per_person_day: '按人天',
  per_hour: '按小时', per_half_day: '按半天',
};

/**
 * 人员计价方式的派生（不落库）。
 * 与 unit_code 双射：person_day ⇔ per_person_day。
 * 这个函数必须判 item_type —— 物料也可按天租赁，不能只看 unit_code。
 */
export function pricingModeOf(
  itemType: 'material' | 'personnel',
  unitCode: string,
): UnitMode | null {
  if (itemType !== 'personnel') return null;
  return unitModeOf(unitCode);
}

export const PRICING_NATURES = ['purchase', 'rental_per_day', 'custom_made', 'service'] as const;
export type PricingNature = (typeof PRICING_NATURES)[number];

export const PRICING_NATURE_LABELS: Record<PricingNature, string> = {
  purchase: '买断',
  rental_per_day: '租赁·按天',
  custom_made: '定制加工',
  service: '人员服务',
};

export const SUPPLIER_TYPES = ['online', 'factory', 'rental', 'freelancer', 'internal'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  online: '线上电商',
  factory: '线下定做厂',
  rental: '租赁商',
  freelancer: '个人兼职',
  internal: '自有',
};

export const PROJECT_TYPES = [
  'annual_meeting', 'product_launch', 'exhibition_booth', 'roadshow', 'framework_client',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  annual_meeting: '年会 / 庆典',
  product_launch: '品牌发布会',
  exhibition_booth: '展台特装',
  roadshow: '路演 / 地推',
  framework_client: '长期框架客户',
};
