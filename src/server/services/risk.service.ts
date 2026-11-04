/**
 * 发送前自检（8 条规则）。
 *
 * 铁律：只有「客户名空 / 活动名空 / 有行没成本」能拦人，其余全是 warning。
 * 把 warning 做成阻断的后果不是"更安全"，而是用户学会闭眼点"仍然继续"，
 * 然后所有提醒一起失效 —— 那比没有提醒更糟。
 */
import { q, today } from '../db';
import { AppError } from '../http';
import { calcQuote, riskLevelOf, runRiskCheck, type RiskFinding } from '@/domain/quote-calc';
import { parseMoney } from '@/domain/money';
import type { QuoteStatus } from '@/domain/quote-status';
import {
  getQuoteRow,
  listQuoteItemRows,
  toCalcLine,
} from '../store/quotes.store';
import { marginWarnRate } from '../store/settings.store';

export interface RiskCheckResult {
  blocked: boolean;
  blocker_count: number;
  warning_count: number;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
  warn_rate_used: string;
  warn_rate_source: 'project_type' | 'global_default';
  valid_until_passed: boolean;
  price_expiring: Array<Record<string, unknown>>;
  negative_margin_items: Array<Record<string, unknown>>;
  zero_price_items: Array<Record<string, unknown>>;
  stale_draft_items: Array<Record<string, unknown>>;
}

export async function riskCheck(quoteId: string): Promise<RiskCheckResult> {
  const quote = await getQuoteRow(quoteId);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  const items = await listQuoteItemRows(quoteId);

  // 行引用价格的失效日 / 现行状态：R7（活动前失效）与「草稿里的价被取代」都要用。
  // 顺带把「取代它的那条现行价」一起查出来：界面要显示「快照价 vs 最新价」，
  // 只给 null 会让前端把金额渲染成空白，看起来像系统坏了。
  const priceIds = items.map((i) => i.price_id).filter((v): v is string => !!v);
  const priceRows = priceIds.length
    ? await q<{
        id: string;
        effective_to: string | null;
        status: string;
        unit_price: string;
        latest_base_unit_price: string | null;
      }>(
        `SELECT p.id, p.effective_to, p.status, p.unit_price,
                -- 归一化口径与比价/取价同一套：档价（min_qty<=1）乘 base_unit_qty，写成除法会整体偏差且不报错
                (SELECT ROUND(COALESCE(t.unit_price, c.unit_price) * COALESCE(c.base_unit_qty, 1), 4)
                   FROM prices c
                   LEFT JOIN LATERAL (
                     SELECT ti.unit_price FROM price_tiers ti
                     WHERE ti.price_id = c.id AND ti.min_qty <= 1
                     ORDER BY ti.min_qty DESC LIMIT 1
                   ) t ON TRUE
                  WHERE c.item_id = p.item_id
                    AND c.supplier_id = p.supplier_id
                    AND c.pricing_nature = p.pricing_nature
                    AND c.tax_included = p.tax_included
                    -- 计价方式也是同组条件：只按 item 取"最新价"会拿租价去比买断价
                    AND c.unit_mode IS NOT DISTINCT FROM p.unit_mode
                    AND c.status = 'active'
                    AND c.effective_from <= CURRENT_DATE
                    AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE)
                  ORDER BY c.effective_from DESC LIMIT 1) AS latest_base_unit_price
           FROM prices p WHERE p.id = ANY($1::uuid[])`,
        [priceIds],
      )
    : [];
  const priceMap = new Map(priceRows.map((p) => [p.id, p]));

  const totals = calcQuote({ lines: items.map(toCalcLine), discountAmount: quote.discount_amount });
  const warn = await marginWarnRate(quote.project_type);
  const todayStr = today();

  const findings = runRiskCheck({
    status: quote.status as QuoteStatus,
    customerName: quote.customer_name,
    eventName: quote.event_name,
    eventDate: quote.event_date,
    taxBasis: quote.tax_statement as 'inclusive' | 'exclusive',
    lines: items.map((row) => ({
      ...toCalcLine(row),
      itemName: row.item_name_snapshot,
      pricingNature: row.pricing_nature ?? 'purchase',
      priceEffectiveTo: row.price_id ? priceMap.get(row.price_id)?.effective_to ?? null : null,
    })),
    totals,
    marginWarnRate: warn.rate,
    marginWarnSource: warn.source,
    today: todayStr,
  });

  const level = riskLevelOf(findings);

  // 以下四个数组是界面按类型展示用的分组视图，与 findings 同源，不参与判定。
  // 必须带 line_indexes（1-based，与界面行号一致）：前端拿不到行号时会退回用
  // item_id 去匹配行 id，同一物料出现在两行时会把两行标成同一行。
  const indexed = items.map((row, i) => ({ row, lineIndex: i + 1 }));

  const priceExpiring = indexed
    .filter(({ row }) => {
      const p = row.price_id ? priceMap.get(row.price_id) : null;
      return !!p?.effective_to && p.effective_to < quote.valid_until;
    })
    .map(({ row, lineIndex }) => ({
      item_id: row.item_id,
      item_name_snapshot: row.item_name_snapshot,
      supplier_name_snapshot: row.supplier_name_snapshot,
      effective_to: priceMap.get(row.price_id!)!.effective_to,
      line_indexes: [lineIndex],
    }));

  const negatives = indexed
    .filter(({ row }) => parseMoney(row.line_profit) < 0n)
    .map(({ row, lineIndex }) => ({
      item_id: row.item_id,
      item_name_snapshot: row.item_name_snapshot,
      line_price: row.line_price,
      line_cost: row.line_cost,
      line_profit: row.line_profit,
      line_indexes: [lineIndex],
    }));

  const zeros = indexed
    .filter(({ row }) => parseMoney(row.sale_unit_price) <= 0n || row.price_missing)
    .map(({ row, lineIndex }) => ({
      item_id: row.item_id,
      item_name_snapshot: row.item_name_snapshot,
      price_missing: row.price_missing,
      sale_unit_price: row.sale_unit_price,
      line_indexes: [lineIndex],
    }));

  const staleDraft = indexed
    .filter(({ row }) => {
      const p = row.price_id ? priceMap.get(row.price_id) : null;
      return !!p && p.status !== 'active';
    })
    .map(({ row, lineIndex }) => ({
      item_id: row.item_id,
      item_name_snapshot: row.item_name_snapshot,
      snapshot_price: row.cost_unit_price,
      latest_price: priceMap.get(row.price_id!)?.latest_base_unit_price ?? null,
      line_indexes: [lineIndex],
    }));

  return {
    blocked: level.blocked,
    blocker_count: level.blockerCount,
    warning_count: level.warningCount,
    blockers: findings.filter((f) => f.level === 'blocker'),
    warnings: findings.filter((f) => f.level === 'warning'),
    warn_rate_used: warn.rate.toFixed(4),
    warn_rate_source: warn.source,
    valid_until_passed: quote.valid_until < todayStr,
    price_expiring: priceExpiring,
    negative_margin_items: negatives,
    zero_price_items: zeros,
    stale_draft_items: staleDraft,
  };
}
