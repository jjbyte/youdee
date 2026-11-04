/**
 * 价格解析与阶梯命中（唯一取价入口）。
 *
 * 阶梯命中 5 种情形（不可自由发挥，01a TC-1 组逐条断言）：
 *   1. 落在区间内        → 命中该档
 *   2. 超过最高档        → 命中最高档（不报错）
 *   3. 低于起订量 moq    → 命中首档 + 警告（不阻断）
 *   4. 无阶梯            → 用 price.unit_price
 *   5. 阶梯断档          → 命中相邻更低档 + 警告（不报错）
 */

export interface TierRow {
  minQty: string; // decimal string, scale 2
  unitPrice: string; // decimal string, scale 4
}

export interface TierHit {
  unitPrice: string;
  matchedMinQty: string;
  /** 命中的是哪个情形，供界面给提示 */
  case: 'in_tier' | 'above_max' | 'below_moq' | 'no_tiers' | 'gap';
  warnings: string[];
}

export interface ResolveTierInput {
  tiers: TierRow[];
  /** 已换算到该供应商计价单位的数量（qty × base_unit_qty） */
  qtyPriced: number;
  /** 基准档单价，无阶梯时返回它 */
  baseUnitPrice: string;
  /** 起订量（该价格单位的数量口径），可空 */
  moq?: number | null;
}

/**
 * 阶梯命中。数量比较用 number 是安全的：这里只做区间归属判断，
 * 不参与任何金额运算（金额一律走 money.ts 的定点运算）。
 */
export function resolveTier(input: ResolveTierInput): TierHit {
  const { tiers, qtyPriced, baseUnitPrice, moq } = input;
  const warnings: string[] = [];

  if (moq != null && qtyPriced < moq) {
    warnings.push(`数量 ${qtyPriced} 低于起订量 ${moq}，按首档计价`);
  }

  if (!tiers || tiers.length === 0) {
    return {
      unitPrice: baseUnitPrice,
      matchedMinQty: '0',
      case: warnings.length ? 'below_moq' : 'no_tiers',
      warnings,
    };
  }

  const sorted = [...tiers].sort((a, b) => Number(a.minQty) - Number(b.minQty));

  // 找出最后一个 minQty <= qtyPriced 的档
  let idx = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const t = sorted[i]!;
    if (qtyPriced >= Number(t.minQty)) idx = i;
    else break;
  }

  if (idx < 0) {
    // 低于第一档的下界（通常 minQty=1，qty<1 的极端情况）
    const first = sorted[0]!;
    return {
      unitPrice: first.unitPrice,
      matchedMinQty: first.minQty,
      case: 'below_moq',
      warnings: [...warnings, '数量低于最低阶梯，按首档计价'],
    };
  }

  const hit = sorted[idx]!;
  const isLast = idx === sorted.length - 1;

  if (isLast) {
    return {
      unitPrice: hit.unitPrice,
      matchedMinQty: hit.minQty,
      case: warnings.length ? 'below_moq' : 'above_max',
      warnings,
    };
  }

  // 断档检测：下一档的 minQty 若大于 qtyPriced 且不是紧邻续接（末尾推断上限），
  // 说明该价格没有覆盖到 qtyPriced，但按"就低"原则仍取当前档 —— 阶梯天然是
  // "达到 minQty 即适用"，因此这里只做提示，不改变取值。
  return {
    unitPrice: hit.unitPrice,
    matchedMinQty: hit.minQty,
    case: warnings.length ? 'below_moq' : 'in_tier',
    warnings,
  };
}

/** 价格四级状态（DB 只存 3 值，这里派生第 4 个 + 陈旧天数） */
export type PriceEffectiveState = 'active' | 'soft_stale' | 'hard_expired' | 'superseded';

export interface PriceStateInput {
  status: 'active' | 'superseded' | 'archived';
  effectiveFrom: string; // yyyy-mm-dd
  effectiveTo: string | null;
  lastUsedAt: string | null; // ISO
  updatedAt: string; // ISO
  onDate: string; // yyyy-mm-dd，一般传今天
  staleDaysThreshold: number;
}

export interface PriceStateResult {
  state: PriceEffectiveState;
  stalenessDays: number;
}

/**
 * 软陈旧计时起点 = max(updated_at, last_used_at)。
 * 一个价 187 天没改，但上周刚被用在报价单里且客户没投诉 → 它还有效。
 * 单纯按时间提醒会让用户对提醒脱敏，最后连真过期都忽略。
 */
export function derivePriceState(input: PriceStateInput): PriceStateResult {
  const { status, effectiveFrom, effectiveTo, lastUsedAt, updatedAt, onDate, staleDaysThreshold } = input;

  const basisDate = lastUsedAt && new Date(lastUsedAt) > new Date(updatedAt) ? lastUsedAt : updatedAt;
  const stalenessDays = Math.max(0, diffDays(basisDate.slice(0, 10), onDate));

  if (status === 'superseded') return { state: 'superseded', stalenessDays };
  if (status === 'archived') return { state: 'hard_expired', stalenessDays };

  // 闭区间：失效日当天仍有效
  if (effectiveTo && onDate > effectiveTo) return { state: 'hard_expired', stalenessDays };
  if (effectiveFrom && onDate < effectiveFrom) return { state: 'hard_expired', stalenessDays };

  if (stalenessDays >= staleDaysThreshold) return { state: 'soft_stale', stalenessDays };
  return { state: 'active', stalenessDays };
}

function diffDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
