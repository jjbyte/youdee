/**
 * 比价的本地计算层（只做展示用算术，金额仍是后端给的字符串）。
 *
 * 为什么放在前端：
 *   ① 数量档切换必须**本地命中**（§C.4 / D.1B），切一档发一次请求会把首屏 1.5s 目标打穿；
 *      接口已经整组返回 tiers，前端只按 qty 命中，不再问服务端。
 *   ② 后端会把 compareState / effectiveState 一起给，但「这一行为什么不参与比价」必须由
 *      同一份规则在前端复现（不可比的行绝不许隐藏）。规则只写在这一个文件里。
 *
 * 不做的事：不放大/不换算——baseUnitPrice 由后端折算（乘法），前端只挑档。
 */
import type { CompareGroup, CompareRow, ExclusiveReason, PricingNature, TaxBasis } from './types';

export type TierCase = 'in_tier' | 'above_max' | 'below_moq' | 'no_tiers' | 'gap';

export interface Hit {
  /** 命中档的单价（原始单位） */
  unitPrice: number | null;
  /** 命中档折算到比价基准单位的单价；不可比时为 null */
  baseUnitPrice: number | null;
  tierMinQty: number | null;
  tierMaxQty: number | null;
  tierCase: TierCase;
  range: string;
}

export interface RankedRow {
  row: CompareRow;
  hit: Hit;
  exclusive: ExclusiveReason;
  isLowest: boolean;
  isLowestTied: boolean;
  /** 相对组内最低价的差率（0.077 = 贵 7.7%）；最低价为 0 或不可比时 null */
  deltaVsLowest: number | null;
  expired: boolean;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function qtyPricedOf(row: CompareRow, qty: number): number {
  const factor = num(row.baseUnitQty) ?? 1;
  return qty * factor;
}

/** 档位命中：5 种情形（区间内 / 超最高档 / 低于起订 / 无阶梯 / 断档） */
export function hitOf(row: CompareRow, qty: number): Hit {
  const qtyPriced = qtyPricedOf(row, qty);
  const tiers = [...(row.tiers ?? [])].sort((a, b) => (num(a.minQty) ?? 0) - (num(b.minQty) ?? 0));
  const moq = num(row.moq);
  const convertible = row.compareState !== 'not_comparable';

  if (tiers.length === 0) {
    const unitPrice = num(row.tierUnitPrice) ?? num(row.baseUnitPrice);
    const belowMoq = moq !== null && qtyPriced < moq;
    return {
      unitPrice,
      baseUnitPrice: convertible ? num(row.baseUnitPrice) : null,
      tierMinQty: null,
      tierMaxQty: null,
      tierCase: belowMoq ? 'below_moq' : 'no_tiers',
      range: '',
    };
  }

  let idx = -1;
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i]!;
    if (qtyPriced >= (num(t.minQty) ?? 0)) idx = i;
    else break;
  }

  if (idx < 0) {
    const first = tiers[0]!;
    return {
      unitPrice: num(first.unitPrice),
      baseUnitPrice: convertible ? num(first.baseUnitPrice) : null,
      tierMinQty: num(first.minQty),
      tierMaxQty: num(first.maxQty),
      tierCase: 'below_moq',
      range: `${num(first.minQty) ?? ''} 起`,
    };
  }

  const t = tiers[idx]!;
  const isLast = idx === tiers.length - 1;
  const nextMin = isLast ? null : num(tiers[idx + 1]!.minQty);
  const maxQty = t.maxQty ? num(t.maxQty) : nextMin !== null ? nextMin - 1 : null;
  const range = maxQty === null ? `${num(t.minQty) ?? ''} 以上` : `${num(t.minQty) ?? ''}–${maxQty}`;

  const belowMoq = moq !== null && qtyPriced < moq;

  return {
    unitPrice: num(t.unitPrice),
    baseUnitPrice: convertible ? num(t.baseUnitPrice) : null,
    tierMinQty: num(t.minQty),
    tierMaxQty: maxQty,
    // 阶梯是「达到 minQty 即适用」，所以只有 命中 / 已享最高档 / 低于起订量 三种
    tierCase: belowMoq ? 'below_moq' : isLast ? 'above_max' : 'in_tier',
    range,
  };
}

/** 「这一行为什么不参与比价」——前端复现同一份规则，保证不可比的行仍然可见并带原因 */
export function exclusiveOf(row: CompareRow, taxBasis: TaxBasis): ExclusiveReason {
  if (row.exclusiveReason) return row.exclusiveReason;
  if (row.effectiveState === 'hard_expired' || row.effectiveState === 'superseded' || row.effectiveState === 'archived') {
    return 'PRICE_EXPIRED';
  }
  if (row.taxIncluded !== (taxBasis === 'inclusive')) return 'TAX_BASIS_MISMATCH';
  if (row.compareState === 'not_comparable') return 'UNIT_NOT_COMPARABLE';
  return null;
}

/** 组内排序：可比的按价格升序 → 不可比置底 → 已失效最后；并算出最低与差率 */
export function rankRows(rows: CompareRow[], taxBasis: TaxBasis, qty: number): RankedRow[] {
  const enriched: RankedRow[] = rows.map((row) => {
    const hit = hitOf(row, qty);
    const exclusive = exclusiveOf(row, taxBasis);
    const expired = exclusive === 'PRICE_EXPIRED';
    return { row, hit, exclusive, isLowest: false, isLowestTied: false, deltaVsLowest: null, expired };
  });

  const eligible = enriched.filter((r) => r.exclusive === null && r.hit.baseUnitPrice !== null);
  let lowest: number | null = null;
  for (const r of eligible) {
    const v = r.hit.baseUnitPrice!;
    if (lowest === null || v < lowest) lowest = v;
  }
  const tieCount = lowest === null ? 0 : eligible.filter((r) => r.hit.baseUnitPrice === lowest).length;

  for (const r of enriched) {
    if (lowest !== null && r.exclusive === null && r.hit.baseUnitPrice !== null) {
      r.isLowest = Math.abs(r.hit.baseUnitPrice - lowest) < 1e-9;
      r.isLowestTied = r.isLowest && tieCount > 1;
      r.deltaVsLowest = lowest === 0 ? null : (r.hit.baseUnitPrice - lowest) / lowest;
    }
  }

  const order = (r: RankedRow) => (r.expired ? 2 : r.exclusive === null ? 0 : 1);
  enriched.sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    if (oa === 0 && a.hit.baseUnitPrice !== null && b.hit.baseUnitPrice !== null) {
      if (a.hit.baseUnitPrice !== b.hit.baseUnitPrice) return a.hit.baseUnitPrice - b.hit.baseUnitPrice;
    }
    return a.row.supplierName.localeCompare(b.row.supplierName, 'zh-CN');
  });
  return enriched;
}

export interface SummaryFacts {
  lowest: RankedRow | null;
  second: RankedRow | null;
  comparableCount: number;
  totalCount: number;
  onlineLowest: RankedRow | null;
  offlineLowest: RankedRow | null;
  /** 正数 = 线下更便宜 */
  offlineCheaperRate: number | null;
  /** 不可比的家数（单位 / 税口径 / 失效） */
  excludedCount: number;
}

export function summarize(ranked: RankedRow[]): SummaryFacts {
  const eligible = ranked.filter((r) => r.exclusive === null && r.hit.baseUnitPrice !== null);
  const lowest = eligible[0] ?? null;
  const second = eligible[1] ?? null;
  const onlineLowest = eligible.find((r) => r.row.supplierType === 'online') ?? null;
  const offlineLowest =
    eligible.find((r) => r.row.supplierType === 'factory' || r.row.supplierType === 'rental') ?? null;
  let offlineCheaperRate: number | null = null;
  if (onlineLowest?.hit.baseUnitPrice && offlineLowest?.hit.baseUnitPrice) {
    const o = onlineLowest.hit.baseUnitPrice;
    const f = offlineLowest.hit.baseUnitPrice;
    if (o !== 0) offlineCheaperRate = (o - f) / o;
  }
  return {
    lowest,
    second,
    comparableCount: eligible.length,
    totalCount: ranked.length,
    onlineLowest,
    offlineLowest,
    offlineCheaperRate,
    excludedCount: ranked.filter((r) => r.exclusive !== null).length,
  };
}

/** 数量档并集：取后端给的 tier_breakpoints，最多 4 档；空则退回接口算出的档 */
export function tierOptions(breakpoints: number[] | undefined, fallback: number): number[] {
  const list = (breakpoints ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const uniq = Array.from(new Set([fallback, ...list].map((n) => Number(n)))).sort((a, b) => a - b);
  return uniq.slice(0, 4);
}

/**
 * 交易性质 Tab 的数据源。
 *
 * 一个性质可能拆成多个组（物料按天租赁 vs 按场租赁，是 per_day / per_event 两组），
 * 所以 Tab 给的是「性质 → 组集合」，切换 Tab 时要一起渲染，不能只取第一组。
 */
export function groupsOfNature(groups: CompareGroup[], nature: PricingNature): CompareGroup[] {
  return groups.filter((g) => g.pricingNature === nature);
}

/** 该性质下所有组的所有行（用于 Tab 上的「N 家」计数） */
export function rowsOfNature(groups: CompareGroup[], nature: PricingNature): CompareRow[] {
  return groupsOfNature(groups, nature).flatMap((g) => g.rows);
}
