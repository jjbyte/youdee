/**
 * 多供应商比价（唯一实现，前后端共用同一份纯函数）。
 *
 * 三层分组，缺一层就出事故：
 *   1. pricing_nature —— 租价与买断价混排会标"租赁商最便宜 500 元/天"，
 *      报价员照着报一个要买断的活动，一单亏几千。
 *   2. tax_basis      —— A 不含税 100、B 含税 105：按不同口径算，谁最低结论相反。
 *      （本函数一次只用一个口径比较，另一口径的行仍返回但置底）
 *   3. compare_state  —— 单位不同且未填折算系数者不参与排序，但**绝不删除**。
 *
 * 铁律：存在但不可比的行一律保留并标记。过滤掉"这家有货但单位没法比"，
 * 用户永远不会想起来补折算系数，也永远以为这家没报价。
 */
import { resolveTier, derivePriceState, type TierRow } from './price-resolve';
import { parseMoney, parseQty, multiplyPriceByQty, applyConversion, qtyToPricingUnit, fmtPrice, fmtQty, divRoundHalfUp, marginRate } from './money';
import type { PricingNature, SupplierType, UnitMode } from './units';

export type CompareState = 'comparable' | 'converted' | 'not_comparable';
export type ExclusionReason =
  | 'TAX_BASIS_MISMATCH'
  | 'UNIT_NOT_COMPARABLE'
  | 'PRICE_EXPIRED'
  | 'NATURE_MISMATCH'
  | null;

export interface CompareRawRow {
  priceId: string;
  supplierId: string;
  supplierName: string;
  supplierType: SupplierType;
  pricingNature: PricingNature;
  unitCode: string;
  baseUnitQty: string | null;
  unitPrice: string;
  moq: string | null;
  taxIncluded: boolean;
  unitMode: UnitMode | null;
  tiers: TierRow[];
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'active' | 'superseded' | 'archived';
  lastUsedAt: string | null;
  updatedAt: string;
  leadTimeDays?: number | null;
}

export interface CompareRow extends CompareRawRow {
  compareState: CompareState;
  /** 该数量档下的原单位单价（未归一） */
  unitPriceAtQty: string;
  /** 归一到比价基准单位的单价（元/㎡ 等）；不可比时为 null */
  baseUnitPrice: string | null;
  /** 相对该组最低价的差率（0.0625 = 贵 6.25%）；最低价为 0 或不可比时 null */
  deltaVsLowest: number | null;
  isLowest: boolean;
  /** 并列最低 */
  isLowestTied: boolean;
  exclusiveReason: ExclusionReason;
  tierCase: string;
  warnings: string[];
  effectiveState: string;
  stalenessDays: number;
  /** 该行的毛利参考（按目标毛利率反推后）。界面不显示，导出/内部版用 */
  note?: string;
}

export interface CompareGroup {
  pricingNature: PricingNature;
  /**
   * 该组的价格口径。人员侧必须按 unit_mode 再分组：
   * 讲师「按场 2800」与「按天 1500」的 pricing_nature 都是 service，
   * 只按 nature 分组会把它们塞进同一组并标"最低 1500"——报价员按按天的价
   * 报了按场的活，一场活动亏一半以上。这与 LED 买断/租赁是同一类事故。
   * 物料侧为 null（非时间口径）。
   */
  unitMode: UnitMode | null;
  taxBasis: 'inclusive' | 'exclusive';
  /** 该组最低归一价（仅统计可参与排序的行） */
  lowestBaseUnitPrice: string | null;
  lowestSupplierId: string | null;
  /** 可参与排序的家数 */
  comparableCount: number;
  /** 总家数（含不可比、含另一口径、含已失效） */
  totalCount: number;
  rows: CompareRow[];
}

export interface CompareInput {
  rows: CompareRawRow[];
  /** 主体设定的比价基准单位；未设则所有跨单位行都不可比 */
  compareUnitCode: string | null;
  /** 用户输入的数量，以比价基准单位计 */
  qtyBase: string;
  /** 本单声明的税口径 */
  taxBasis: 'inclusive' | 'exclusive';
  onDate: string;
  staleDaysThreshold: number;
  /** 只比某个交易性质（界面 Tab）；不传则返回全部组 */
  onlyNature?: PricingNature | null;
}

export function computeComparison(input: CompareInput): CompareGroup[] {
  const { rows, compareUnitCode, qtyBase, taxBasis, onDate, staleDaysThreshold, onlyNature } = input;

  const byGroup = new Map<string, CompareRawRow[]>();
  for (const row of rows) {
    if (onlyNature && row.pricingNature !== onlyNature) continue;
    const key = `${row.pricingNature}::${row.unitMode ?? ''}`;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }

  const groups: CompareGroup[] = [];

  for (const list of byGroup.values()) {
    const nature = list[0]!.pricingNature;
    const unitMode = list[0]!.unitMode ?? null;
    const enriched: CompareRow[] = list.map((row) => enrichRow(row, compareUnitCode, qtyBase, taxBasis, onDate, staleDaysThreshold));

    // 可参与排序：无排除原因
    const eligible = enriched.filter((r) => r.exclusiveReason === null && r.baseUnitPrice !== null);
    let lowest: bigint | null = null;
    for (const r of eligible) {
      const v = parseMoney(r.baseUnitPrice!);
      if (lowest === null || v < lowest) lowest = v;
    }

    const tieCount = lowest === null ? 0 : eligible.filter((r) => parseMoney(r.baseUnitPrice!) === lowest).length;

    for (const r of enriched) {
      if (lowest !== null && r.baseUnitPrice !== null && r.exclusiveReason === null) {
        const v = parseMoney(r.baseUnitPrice);
        r.isLowest = v === lowest;
        r.isLowestTied = r.isLowest && tieCount > 1;
        r.deltaVsLowest = lowest === 0n ? null : Number(divRoundHalfUp((v - lowest) * 10000n, lowest)) / 10000;
      } else {
        r.isLowest = false;
        r.isLowestTied = false;
        r.deltaVsLowest = null;
      }
    }

    // 排序：可比的按价格升序 → 不可比的置底 → 已失效置最后
    enriched.sort((a, b) => {
      const rank = (r: CompareRow) =>
        r.exclusiveReason === null ? 0 : r.exclusiveReason === 'PRICE_EXPIRED' ? 2 : 1;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0 && a.baseUnitPrice && b.baseUnitPrice) {
        const va = parseMoney(a.baseUnitPrice);
        const vb = parseMoney(b.baseUnitPrice);
        if (va !== vb) return va < vb ? -1 : 1;
      }
      return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
    });

    const lowestRow = enriched.find((r) => r.isLowest) ?? null;

    groups.push({
      pricingNature: nature,
      unitMode,
      taxBasis,
      lowestBaseUnitPrice: lowest === null ? null : fmtPrice(lowest, 4),
      lowestSupplierId: lowestRow?.supplierId ?? null,
      comparableCount: eligible.length,
      totalCount: enriched.length,
      rows: enriched,
    });
  }

  // 稳定顺序：买断 → 租 → 定制 → 服务；同性质内按时间口径（按天 → 按场 → 按人天 → 按小时 → 按半天）
  const natureOrder: PricingNature[] = ['purchase', 'rental_per_day', 'custom_made', 'service'];
  const modeOrder: (UnitMode | null)[] = ['per_day', 'per_event', 'per_person_day', 'per_hour', 'per_half_day', null];
  const modeRank = (m: UnitMode | null) => {
    const i = modeOrder.indexOf(m);
    return i < 0 ? modeOrder.length : i;
  };
  groups.sort((a, b) => {
    const d = natureOrder.indexOf(a.pricingNature) - natureOrder.indexOf(b.pricingNature);
    if (d !== 0) return d;
    return modeRank(a.unitMode) - modeRank(b.unitMode);
  });
  return groups;
}

function enrichRow(
  row: CompareRawRow,
  compareUnitCode: string | null,
  qtyBase: string,
  taxBasis: 'inclusive' | 'exclusive',
  onDate: string,
  staleDaysThreshold: number,
): CompareRow {
  const stateRes = derivePriceState({
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    lastUsedAt: row.lastUsedAt,
    updatedAt: row.updatedAt,
    onDate,
    staleDaysThreshold,
  });

  // ① 可比性（只看单位，先不算价格）
  let compareState: CompareState;
  if (!compareUnitCode || row.unitCode === compareUnitCode) {
    compareState = 'comparable';
  } else if (row.baseUnitQty !== null) {
    compareState = 'converted';
  } else {
    compareState = 'not_comparable';
  }

  // ② 数量换算 + 阶梯命中
  // 数量必须按 scale2 解析。这里曾用 parseMoney（scale4），传入 qtyToPricingUnit 后
  // 数量被放大 100 倍，选档位与判起订量全部落在错误的档上 —— 而且不报错，只是价不对。
  const qtyBaseScaled = parseQty(qtyBase);
  let qtyPricedNum = Number(qtyBase);
  if (compareState === 'converted' && row.baseUnitQty) {
    try {
      const converted = qtyToPricingUnit(qtyBaseScaled, row.baseUnitQty);
      qtyPricedNum = Number(fmtQty(converted));
    } catch {
      compareState = 'not_comparable';
    }
  }

  const tier = resolveTier({
    tiers: row.tiers,
    qtyPriced: qtyPricedNum,
    baseUnitPrice: row.unitPrice,
    moq: row.moq === null ? null : Number(row.moq),
  });

  // ③ 归一到基准单位
  let baseUnitPrice: string | null = null;
  if (compareState === 'comparable') {
    baseUnitPrice = fmtPrice(parseMoney(tier.unitPrice), 4);
  } else if (compareState === 'converted') {
    try {
      baseUnitPrice = fmtPrice(applyConversion(parseMoney(tier.unitPrice), row.baseUnitQty), 4);
    } catch {
      compareState = 'not_comparable';
      baseUnitPrice = null;
    }
  }

  // ④ 排除原因（优先级：过期 > 口径 > 单位）
  let exclusiveReason: ExclusionReason = null;
  if (stateRes.state === 'hard_expired' || stateRes.state === 'superseded') {
    exclusiveReason = 'PRICE_EXPIRED';
  } else if (row.taxIncluded !== (taxBasis === 'inclusive')) {
    exclusiveReason = 'TAX_BASIS_MISMATCH';
  } else if (compareState === 'not_comparable') {
    exclusiveReason = 'UNIT_NOT_COMPARABLE';
  }

  const warnings = [...tier.warnings];
  if (stateRes.state === 'soft_stale') {
    warnings.push(`该价格 ${stateRes.stalenessDays} 天未核价，建议先问一家确认`);
  }
  if (exclusiveReason === 'TAX_BASIS_MISMATCH') {
    warnings.push(`该供应商只报了${row.taxIncluded ? '含税' : '不含税'}价，与本单口径不同，不参与排序`);
  }
  if (exclusiveReason === 'UNIT_NOT_COMPARABLE') {
    warnings.push(`单位为「${row.unitCode}」，与比价基准不同且未填折算系数，不可比`);
  }

  return {
    ...row,
    compareState,
    unitPriceAtQty: fmtPrice(parseMoney(tier.unitPrice), 4),
    baseUnitPrice,
    deltaVsLowest: null,
    isLowest: false,
    isLowestTied: false,
    exclusiveReason,
    tierCase: tier.case,
    warnings,
    effectiveState: stateRes.state,
    stalenessDays: stateRes.stalenessDays,
  };
}

/** 摘要条：产品最容易被理解的一句话，也是宣传截图那一屏 */
export interface CompareSummary {
  lowestText: string | null;
  onlineLowest: string | null;
  offlineLowest: string | null;
  /** 线下比线上便宜的比例（正数=线下更便宜）；任一侧无数据则 null */
  offlineCheaperRate: number | null;
  comparableCount: number;
}

export function summarizeCompare(group: CompareGroup): CompareSummary {
  const eligible = group.rows.filter((r) => r.exclusiveReason === null && r.baseUnitPrice !== null);
  const online = eligible.filter((r) => r.supplierType === 'online');
  const offline = eligible.filter((r) => r.supplierType === 'factory' || r.supplierType === 'rental');

  const minOf = (list: CompareRow[]): CompareRow | null => {
    let best: CompareRow | null = null;
    for (const r of list) {
      if (!best) { best = r; continue; }
      if (parseMoney(r.baseUnitPrice!) < parseMoney(best.baseUnitPrice!)) best = r;
    }
    return best;
  };

  const onlineBest = minOf(online);
  const offlineBest = minOf(offline);
  const overall = minOf(eligible);

  let offlineCheaperRate: number | null = null;
  if (onlineBest?.baseUnitPrice && offlineBest?.baseUnitPrice) {
    const o = parseMoney(onlineBest.baseUnitPrice);
    const f = parseMoney(offlineBest.baseUnitPrice);
    if (o !== 0n) offlineCheaperRate = Number(divRoundHalfUp((o - f) * 10000n, o)) / 10000;
  }

  return {
    lowestText: overall
      ? `${fmtPrice(parseMoney(overall.baseUnitPrice!), 2)} ${overall.supplierName}`
      : null,
    onlineLowest: onlineBest ? `${fmtPrice(parseMoney(onlineBest.baseUnitPrice!), 2)} ${onlineBest.supplierName}` : null,
    offlineLowest: offlineBest ? `${fmtPrice(parseMoney(offlineBest.baseUnitPrice!), 2)} ${offlineBest.supplierName}` : null,
    offlineCheaperRate,
    comparableCount: eligible.length,
  };
}

/** 导出用：整单毛利率（分母是报价合计，不是成本） */
export function quoteMargin(profitScaled: bigint, priceTotalScaled: bigint): number | null {
  return marginRate(profitScaled, priceTotalScaled);
}

export { multiplyPriceByQty };
