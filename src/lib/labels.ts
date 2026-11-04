/**
 * 码表（唯一出口）。界面永远显示中文，枚举码只出现在接口参数里。
 *
 * 两套单位码表故意不互转（§C.4 三字段分工）：
 *   UNIT_LABELS      —— unit_code 短码（表单选项值、展示兜底）
 *   UNIT_MODE_LABELS —— unit_mode 带前缀（分组与展示），只有 5 项 + NULL
 * 非时间类单位不生成 unit_mode 标签，展示退回 unit_code 中文，不拼「按㎡」。
 */
import type {
  ItemType,
  PricingNature,
  ProjectType,
  QuoteStatus,
  SupplierType,
  TaxBasis,
  UnitMode,
} from './types';

export const UNIT_LABELS: Record<string, string> = {
  piece: '个',
  case: '件',
  block: '块',
  sheet: '张',
  set: '套',
  group: '组',
  sqm: '㎡',
  linear_m: '延米',
  meter: 'm',
  day: '天',
  session: '场',
  batch: '批',
  root: '根',
  roll: '卷',
  person_day: '人天',
  hour: '小时',
  half_day: '半天',
};

export function unitLabel(code: string | null | undefined, fallbackName?: string | null): string {
  if (!code) return fallbackName || '';
  return UNIT_LABELS[code] ?? fallbackName ?? code;
}

export const UNIT_MODE_LABELS: Record<UnitMode, string> = {
  per_day: '按天',
  per_event: '按场',
  per_person_day: '按人天',
  per_hour: '按小时',
  per_half_day: '按半天',
};

export function unitModeLabel(mode: UnitMode | null | undefined): string {
  if (!mode) return '';
  return UNIT_MODE_LABELS[mode] ?? '';
}

export const PRICING_NATURE_LABELS: Record<PricingNature, string> = {
  purchase: '买断',
  rental_per_day: '租赁·按天',
  custom_made: '定制加工',
  service: '人员服务',
};

export function natureLabel(nature: PricingNature | null | undefined): string {
  if (!nature) return '';
  return PRICING_NATURE_LABELS[nature] ?? '';
}

/**
 * 分组 / Tab 的显示名。
 * 物料时间类单位要带计价方式（租赁·按天）；人员只按计价方式分段（按场 / 按天）；
 * 非时间类物料退化成纯性质（买断 / 定制加工）。
 */
export function groupLabel(
  nature: PricingNature,
  mode: UnitMode | null,
  itemType: ItemType,
): string {
  if (itemType === 'personnel') return unitModeLabel(mode) || '人员服务';
  if (nature === 'rental_per_day' && mode) return `租赁·${unitModeLabel(mode)}`;
  return natureLabel(nature);
}

/** 组内最低价的单位后缀：¥500/天、¥380/㎡ */
export function unitSuffix(unitCode: string | null | undefined, name?: string | null): string {
  const u = unitLabel(unitCode, name);
  return u ? `/${u}` : '';
}

export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  online: '线上电商',
  factory: '线下定做厂',
  rental: '租赁商',
  freelancer: '个人兼职',
  internal: '自有',
};

export function supplierTypeLabel(t: SupplierType | null | undefined, itemType?: ItemType): string {
  if (!t) return '';
  // freelancer 的话术按对象变：物料侧「经纪公司」，人员侧「个人 / 经纪」
  if (t === 'freelancer' && itemType === 'material') return '经纪公司';
  if (t === 'freelancer') return '个人 / 经纪';
  return SUPPLIER_TYPE_LABELS[t] ?? t;
}

export const SUPPLIER_TYPE_ORDER: SupplierType[] = ['online', 'factory', 'rental', 'freelancer', 'internal'];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: '草稿',
  issued: '已发出',
  void: '已作废',
};

export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['draft', 'issued', 'void'];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  annual_meeting: '年会 / 庆典',
  product_launch: '品牌发布会',
  exhibition_booth: '展台特装',
  roadshow: '路演 / 地推',
  framework_client: '长期框架客户',
};

export const PROJECT_TYPE_ORDER: ProjectType[] = [
  'annual_meeting',
  'product_launch',
  'exhibition_booth',
  'roadshow',
  'framework_client',
];

export function projectTypeLabel(t: ProjectType | null | undefined): string {
  if (!t) return '未选（按默认 25%）';
  return PROJECT_TYPE_LABELS[t] ?? t;
}

export const TAX_BASIS_LABELS: Record<TaxBasis, string> = {
  inclusive: '含税',
  exclusive: '不含税',
};

export function taxBasisLabel(b: TaxBasis | null | undefined): string {
  if (!b) return '';
  return TAX_BASIS_LABELS[b] ?? b;
}

/**
 * 比价降级原因文案：只做精确匹配，未命中退回兜底文案（§F.24）。
 * 不按字符串前缀判断场景，不抛错、不白屏。
 */
export function compareReasonText(
  reason: string | null | undefined,
  basisDimension: string | null | undefined,
): string {
  switch (reason) {
    case 'MIXED_BASIS':
      return basisDimension === 'tax'
        ? '这一组里有的含税、有的不含税，差价里混着税，不能直接比'
        : '这一组的单位或计价方式不一致，不能直接比';
    case 'ONLY_OTHER_BASIS':
      return '有供应商只报了另一个口径的价，不计入这个口径';
    case 'NO_COMPARABLE_UNIT':
      return '单位不一致，填了换算关系才能比';
    case 'SINGLE_ROW':
      return '只有 1 家能比，再录一家才看得出贵不贵';
    default:
      return '口径不一样，不给你标最低';
  }
}

/** 单行被排除的原因（不可比的行不许隐藏，必须带原因） */
export function exclusiveReasonText(
  reason: string | null | undefined,
  ctx: { taxIncluded?: boolean; pageTaxBasis?: TaxBasis },
): string {
  switch (reason) {
    case 'TAX_BASIS_MISMATCH': {
      const own = ctx.taxIncluded ? '含税' : '不含税';
      const page = ctx.pageTaxBasis === 'exclusive' ? '不含税' : '含税';
      return `只有${own}价，本页按${page}比`;
    }
    case 'UNIT_NOT_COMPARABLE':
      return '单位不一致，没填换算关系';
    case 'PRICE_EXPIRED':
      return '这个价已失效';
    case 'NATURE_MISMATCH':
      return '交易性质不同，不能比';
    default:
      return '';
  }
}

export const EFFECTIVE_STATE_LABELS: Record<string, string> = {
  valid: '有效',
  soft_stale: '待核价',
  hard_expired: '已失效',
  superseded: '被替代',
  archived: '已作废',
};

export function effectiveStateLabel(state: string | null | undefined): string {
  if (!state) return '';
  return EFFECTIVE_STATE_LABELS[state] ?? state;
}

export function missingReasonText(reason: string): string {
  if (reason === 'NO_VALID_PRICE') return '今天没有有效价';
  return '没有能用的价';
}

/** 阶梯命中情形（§C.4 五种情形，前端照此实现） */
export function tierCaseText(tierCase: string | null | undefined, range?: string): string {
  switch (tierCase) {
    case 'in_tier':
      return range ? `命中 ${range} 档` : '命中阶梯';
    case 'above_max':
      return '已享最高档';
    case 'no_tiers':
      return '无阶梯';
    case 'gap':
      return range ? `按 ${range} 档计` : '按相邻档计';
    case 'below_moq':
      return '低于起订量';
    default:
      return '';
  }
}
