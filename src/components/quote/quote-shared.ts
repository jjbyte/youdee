/**
 * 报价单编辑器的共享逻辑（唯一出口）。
 *
 * 三件必须只写一处的事：
 *   ① **阻断唯一条件**：有行的成本是 null 或 ≤ 0。不看 cost_source、不看软陈旧、
 *      不看毛利正负、不看是不是最低价。写成一行，谁都别在这上面加条件。
 *   ② 行的 PATCH 请求体：openapi 的 QuoteItemInput 有 5 个必填字段，
 *      局部更新也必须把它们带上（否则 400），所以统一由 linePatchBody 组装。
 *   ③ 分组：按行上的 categorySnapshot 分段，小计按**该组全部行**算
 *      （导出时隐藏行会整行剔除并重算，但屏幕上那行必须留着）。
 */
import type { PricingNature, QuoteItem } from '@/lib/types';

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/**
 * 攒单时给某个物料指定的那一家（用户在选品面板里选了非「自动」的一项）。
 *
 * 为什么带着 pricingNature：一个物料可能同时有「租赁·按天」和「买断」两种价，
 * 选供应商的同时也就把交易性质定死了——两者不能分两次问，否则会拼出一条
 * "A 家的价 + B 家的性质"的组合，价格库里根本不存在这样的组合。
 */
export interface SupplierPick {
  pricingNature: PricingNature;
  priceId: string;
  supplierId: string;
  supplierName: string;
}

export interface LineGroup {
  key: string;
  title: string;
  lines: QuoteItem[];
  cost: number;
  price: number;
}

export function groupLines(items: QuoteItem[]): LineGroup[] {
  const map = new Map<string, QuoteItem[]>();
  for (const line of items) {
    const key = line.categorySnapshot?.trim() || '未分类';
    const arr = map.get(key);
    if (arr) arr.push(line);
    else map.set(key, [line]);
  }
  return Array.from(map.entries()).map(([key, lines], i) => ({
    key,
    title: `${CN_NUM[i] ?? String(i + 1)}、${key}`,
    lines,
    cost: lines.reduce((a, l) => a + Number(l.lineCost ?? 0), 0),
    price: lines.reduce((a, l) => a + Number(l.linePrice ?? 0), 0),
  }));
}

/** 成本缺失 = 没有成本数（null）或填了个 ≤ 0 的数 */
export function lineHasCost(line: QuoteItem): boolean {
  return line.costUnitPrice !== null && Number(line.costUnitPrice) > 0;
}

/** 阻断的唯一规则（§C.7 写成一行伪代码，前端照抄） */
export function isBlockedByMissingCost(items: QuoteItem[]): boolean {
  return items.some((l) => !lineHasCost(l));
}

/** 手工改过对客价（不再跟随整单毛利率）——用行毛利率反推不可靠，用 cost_source + 手改标记 */
export function isManualPriced(line: QuoteItem): boolean {
  return line.costSource === 'manual';
}

export function lineMargin(line: QuoteItem): number | null {
  const price = Number(line.linePrice);
  if (!Number.isFinite(price) || price === 0) return null;
  return Number(line.lineProfit) / price;
}

/** PATCH /quotes/{id}/items/{itemId} 的请求体（必填字段一并回传） */
export function linePatchBody(
  line: QuoteItem,
  changes: Partial<Record<'qty' | 'costUnitPrice' | 'costSource' | 'saleUnitPrice' | 'isVisibleToCustomer' | 'remark', unknown>>,
): Record<string, unknown> {
  return {
    lineKind: line.lineKind,
    itemNameSnapshot: line.itemNameSnapshot,
    unitSnapshot: line.unitSnapshot,
    qty: line.qty,
    costSource: line.costSource,
    ...changes,
  };
}

/** 毛利率转「成本倍率」文案：毛利率 40% → 成本 × 1.667（这一行必须常驻，§C.7 行业陷阱） */
export function marginToMultiplier(rate: number): string {
  if (!Number.isFinite(rate) || rate >= 1 || rate <= 0) return '—';
  return (1 / (1 - rate)).toFixed(3);
}

/** 百分比输入（用户填 40，存 0.40） */
export function parsePercentInput(raw: string): number | null {
  const n = Number(raw.replace(/[%％\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n / 100;
}
