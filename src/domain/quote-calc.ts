/**
 * 报价单金额计算与发送前自检（唯一实现）。
 *
 * 计算链（严格按此顺序，不得先舍单价再乘）：
 *   行成本 = round(cost_unit_price × qty, 2)
 *   行报价 = round(sale_unit_price × qty, 2)
 *   行利润 = 行报价 − 行成本
 *   整单报价合计 = Σ行报价 − 整单优惠
 *   整单毛利 = 整单报价合计 − Σ行成本
 *   整单毛利率 = 整单毛利 / 整单报价合计   ← 分母是报价合计，不是成本
 *
 * 毛利率 ≠ 加成率。报价员说"我加 40 个点"是成本 ×1.4，真实毛利率只有 28.6%；
 * 系统只出现毛利率一个数，界面禁用"加价率"这个词。
 */
import {
  parseMoney, parseAmount, parseQty, multiplyPriceByQty, priceFromMargin, marginRate, fmtPrice, fmtAmount,
} from './money';
import { evaluateIssueBlocking, type QuoteStatus } from './quote-status';

export interface CalcLineInput {
  qty: string;
  costUnitPrice: string;
  saleUnitPrice: string;
  costSource: 'price_book' | 'manual';
  /** 录单时同性质同口径的最低有效价，用于"为什么没选最便宜的" */
  referenceLowestPrice?: string | null;
  isVisibleToCustomer: boolean;
}

export interface CalcLineResult {
  lineCost: string;
  linePrice: string;
  lineProfit: string;
  lineMargin: number | null;
}

/**
 * 行的定点中间值（scale 2），只在文件内部流转。
 * 存在的理由：合计必须用**未格式化的定点值**累加。把行小计格式化成
 * "1000.00" 再 parse 回来当 scale4 用，会让 2000 元变 200000 元 —— 而且不报错。
 */
interface LineScaled {
  cost2: bigint;
  price2: bigint;
  profit2: bigint;
}

function calcLineScaled(line: CalcLineInput): LineScaled {
  const qty = parseQty(line.qty);
  const cost2 = multiplyPriceByQty(parseMoney(line.costUnitPrice), qty);
  const price2 = multiplyPriceByQty(parseMoney(line.saleUnitPrice), qty);
  return { cost2, price2, profit2: price2 - cost2 };
}

export function calcLine(line: CalcLineInput): CalcLineResult {
  const { cost2, price2, profit2 } = calcLineScaled(line);
  return {
    lineCost: fmtAmount(cost2),
    linePrice: fmtAmount(price2),
    lineProfit: fmtAmount(profit2),
    lineMargin: marginRate(profit2, price2),
  };
}

export interface CalcQuoteInput {
  lines: CalcLineInput[];
  discountAmount: string;
}

export interface CalcQuoteResult {
  totalCost: string;
  totalPrice: string;
  totalProfit: string;
  marginRate: number | null;
  minLineMargin: number | null;
  lineResults: CalcLineResult[];
}

export function calcQuote(input: CalcQuoteInput): CalcQuoteResult {
  let cost = 0n;
  let price = 0n;
  let minLine: number | null = null;

  const lineResults = input.lines.map((l) => {
    const s = calcLineScaled(l);
    cost += s.cost2;
    price += s.price2;
    const m = marginRate(s.profit2, s.price2);
    if (m !== null) {
      minLine = minLine === null ? m : Math.min(minLine, m);
    }
    return {
      lineCost: fmtAmount(s.cost2),
      linePrice: fmtAmount(s.price2),
      lineProfit: fmtAmount(s.profit2),
      lineMargin: m,
    };
  });

  const discount = parseAmount(input.discountAmount || '0');
  const priceAfterDiscount = price - discount;
  const profit = priceAfterDiscount - cost;

  return {
    totalCost: fmtAmount(cost),
    totalPrice: fmtAmount(priceAfterDiscount),
    totalProfit: fmtAmount(profit),
    marginRate: marginRate(profit, priceAfterDiscount),
    minLineMargin: minLine,
    lineResults,
  };
}

/** 一键按目标毛利率反推对客价（仅对自动定价行生效，手改过的行不跟随） */
export function applyTargetMargin(
  costUnitPrice: string,
  targetMarginRate: number,
): string {
  return fmtPrice(priceFromMargin(parseMoney(costUnitPrice), targetMarginRate), 4);
}

// ── 发送前自检 ────────────────────────────────────────────────

export type RiskLevel = 'blocker' | 'warning';

export interface RiskFinding {
  code: string;
  level: RiskLevel;
  title: string;
  detail: string;
  /** 涉及的行号（1-based，对应界面顺序），无则空 */
  lineIndexes: number[];
}

export interface RiskCheckInput {
  status: QuoteStatus;
  customerName: string;
  eventName: string;
  eventDate: string | null;
  taxBasis: 'inclusive' | 'exclusive';
  lines: Array<CalcLineInput & {
    itemName: string;
    pricingNature: string;
    /** 该行价格的有效期，用于"将在活动日前失效" */
    priceEffectiveTo?: string | null;
  }>;
  totals: CalcQuoteResult;
  /** 预警线：按项目类型取值，缺失回退全局 */
  marginWarnRate: number;
  /** 预警线来源，用于界面说明"低于「品牌发布会」的 22%" */
  marginWarnSource: 'project_type' | 'global_default';
  today: string;
}

/**
 * 8 条规则：1 条 blocker（客户名/活动名空 + 有行无成本）+ 7 条 warning。
 * **没有任何一条会拦截负毛利、软陈旧、非最低价。**
 */
export function runRiskCheck(input: RiskCheckInput): RiskFinding[] {
  const findings: RiskFinding[] = [];

  // ── blockers ──
  const blocking = evaluateIssueBlocking({
    hasLineWithoutCost: input.lines.some((l) => l.costSource === 'manual' && !l.costUnitPrice),
    customerName: input.customerName,
    eventName: input.eventName,
  });
  if (blocking.blocked) {
    findings.push({
      code: 'R_NAME_REQUIRED',
      level: 'blocker',
      title: '单据信息不完整',
      detail: blocking.blockers.join('；'),
      lineIndexes: [],
    });
  }

  // R1 毛利率低于阈值（只变颜色 + 提示，不阻断）
  const margin = input.totals.marginRate;
  if (margin !== null && margin < input.marginWarnRate) {
    findings.push({
      code: 'R1_MARGIN_LOW',
      level: 'warning',
      title: '整单毛利率低于预警线',
      detail: `当前 ${(margin * 100).toFixed(1)}%，低于${
        input.marginWarnSource === 'project_type' ? '本项目类型的' : '默认的'
      } ${(input.marginWarnRate * 100).toFixed(0)}%。确认这单是走量或维护关系，再发出。`,
      lineIndexes: [],
    });
  }

  // R2 存在手填成本行
  const manualIdx = input.lines
    .map((l, i) => (l.costSource === 'manual' ? i : -1))
    .filter((i) => i >= 0);
  if (manualIdx.length > 0) {
    findings.push({
      code: 'R2_MANUAL_COST',
      level: 'warning',
      title: `${manualIdx.length} 行成本是手填的`,
      detail: '手填成本没有价格库支撑，出单后无法追溯来源。方便的话补录一条价格。',
      lineIndexes: manualIdx.map((i) => i + 1),
    });
  }

  // R3 成本高于同性质同口径最低价
  const expensive = input.lines
    .map((l, i) => {
      if (!l.referenceLowestPrice) return -1;
      return parseMoney(l.costUnitPrice) > parseMoney(l.referenceLowestPrice) ? i : -1;
    })
    .filter((i) => i >= 0);
  if (expensive.length > 0) {
    findings.push({
      code: 'R3_ABOVE_LOWEST',
      level: 'warning',
      title: `${expensive.length} 行采用的不是最低价`,
      detail: '可能是有交期、质量或关系上的考虑。若不是，换供应商能省下来。',
      lineIndexes: expensive.map((i) => i + 1),
    });
  }

  // R4 负毛利
  if (parseAmount(input.totals.totalProfit) < 0n) {
    findings.push({
      code: 'R4_NEGATIVE_PROFIT',
      level: 'warning',
      title: '整单毛利为负',
      detail: `当前亏 ${input.totals.totalProfit} 元。有些单是故意亏的（走量、拿案例），确认后可以照常发出。`,
      lineIndexes: [],
    });
  }

  // R5 对客价为 0 或空
  const zeroPrice = input.lines
    .map((l, i) => (parseMoney(l.saleUnitPrice) <= 0n ? i : -1))
    .filter((i) => i >= 0);
  if (zeroPrice.length > 0) {
    findings.push({
      code: 'R5_ZERO_SALE_PRICE',
      level: 'warning',
      title: `${zeroPrice.length} 行对客价为 0`,
      detail: '如果是要送给客户的项，请把该行标记为「不在客户版显示」，避免客户以为漏报。',
      lineIndexes: zeroPrice.map((i) => i + 1),
    });
  }

  // R6 行毛利为负
  const negLine = input.totals.lineResults
    .map((r, i) => (r.lineMargin !== null && r.lineMargin < 0 ? i : -1))
    .filter((i) => i >= 0);
  if (negLine.length > 0) {
    findings.push({
      code: 'R6_LINE_LOSS',
      level: 'warning',
      title: `${negLine.length} 行报价低于成本`,
      detail: '这几行单独看是亏的，如果靠其他行补回来，可以照常发。',
      lineIndexes: negLine.map((i) => i + 1),
    });
  }

  // R7 价格将在活动日期前失效 / 价格早于活动日
  if (input.eventDate) {
    const expiring = input.lines
      .map((l, i) =>
        l.priceEffectiveTo && l.priceEffectiveTo < input.eventDate! ? i : -1,
      )
      .filter((i) => i >= 0);
    if (expiring.length > 0) {
      findings.push({
        code: 'R7_PRICE_EXPIRES_BEFORE_EVENT',
        level: 'warning',
        title: `${expiring.length} 行价格在活动日期前就失效了`,
        detail: '出单时不会报错，但执行时可能拿不到这个价。建议先跟供应商确认续期。',
        lineIndexes: expiring.map((i) => i + 1),
      });
    }
  }

  return findings;
}

export function riskLevelOf(findings: RiskFinding[]): {
  blocked: boolean;
  blockerCount: number;
  warningCount: number;
} {
  const blockerCount = findings.filter((f) => f.level === 'blocker').length;
  const warningCount = findings.filter((f) => f.level === 'warning').length;
  return { blocked: blockerCount > 0, blockerCount, warningCount };
}
