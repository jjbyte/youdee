/**
 * 切换税口径：试算与落库共用同一份「计划」。
 *
 * 为什么要拆成 plan（只读）+ apply（写库）：如果试算和落库各写一遍取价，
 * 提示里的合计与实际发出的单必然在某次改动后分叉，而分叉的后果是
 * 用户按 ¥12,308.33 跟客户确认、系统发出 ¥12,356.67 的单。
 *
 * 一条硬不变量：切口径**不改对客价**（ARCH §9.5）。对客价是商务判断，
 * 系统路径只允许改成本；缺价行保持原对客价，否则一个数据缺口会顺手把
 * 报价员谈下来的价格清掉。
 */
import { today, tx } from '../db';
import { calcQuote } from '@/domain/quote-calc';
import { AppError } from '../http';
import { getQuoteRow, listQuoteItemRows, recalcAndPersist, toCalcLine, type QuoteItemRow, type QuoteRow } from '../store/quotes.store';
import { staleDaysThreshold, type TaxBasis } from '../store/settings.store';
import { resolveOne } from './lookup.service';
import { q } from '../db';

export interface PlanLine {
  line_id: string;
  item_name_snapshot: string;
  supplier_name_snapshot: string | null;
  pricing_mode: 'auto' | 'manual';
  old_cost: string;
  new_cost: string | null;
  old_sale: string;
  new_sale: string;
  will_be_missing: boolean;
  old_price_id: string | null;
  new_price_id: string | null;
  changed: boolean;
}

export interface SwitchPlan {
  lines: PlanLine[];
  total_before: string;
  total_after: string;
  cost_before: string;
  cost_after: string;
  margin_before: string | null;
  margin_after: string | null;
  changed_lines: number;
  auto_priced_lines: number;
  manual_priced_lines: number;
  missing_after: number;
}

interface PriceBrief {
  id: string;
  item_id: string;
  supplier_id: string;
  pricing_nature: string;
  unit_mode: string | null;
}

async function loadPrices(ids: string[]): Promise<Map<string, PriceBrief>> {
  const map = new Map<string, PriceBrief>();
  if (ids.length === 0) return map;
  const rows = await q<PriceBrief>(
    `SELECT id, item_id, supplier_id, pricing_nature, unit_mode FROM prices WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  for (const r of rows) map.set(r.id, r);
  return map;
}

export async function planTaxBasisSwitch(
  quote: QuoteRow,
  items: QuoteItemRow[],
  newBasis: TaxBasis,
): Promise<SwitchPlan> {
  const stale = await staleDaysThreshold();
  const onDate = today();
  const priceIds = items.map((i) => i.price_id).filter((v): v is string => !!v);
  const prices = await loadPrices(priceIds);

  const lines: PlanLine[] = [];
  const hypothetical = items.map(toCalcLine);

  for (let idx = 0; idx < items.length; idx += 1) {
    const row = items[idx]!;
    const line = hypothetical[idx]!;
    const base = {
      line_id: row.id,
      item_name_snapshot: row.item_name_snapshot,
      supplier_name_snapshot: row.supplier_name_snapshot,
      old_cost: row.cost_unit_price,
      old_sale: row.sale_unit_price,
      old_price_id: row.price_id,
    };

    const priceRow = row.price_id ? prices.get(row.price_id) : undefined;
    if (!priceRow || row.cost_source === 'manual') {
      lines.push({
        ...base,
        pricing_mode: 'manual',
        new_cost: row.cost_unit_price,
        new_sale: row.sale_unit_price,
        // 手填行本来就不依赖价格库，切口径不会让它"变缺价"：
        // 契约里 will_be_missing=true 等价于"new_cost 为 null"，这里 new_cost 有值，必须给 false。
        will_be_missing: false,
        new_price_id: row.price_id,
        changed: false,
      });
      continue;
    }

    const hit = await resolveOne(
      {
        itemId: priceRow.item_id,
        qty: row.qty,
        pricingNature: priceRow.pricing_nature,
        taxBasis: newBasis,
        onDate,
        supplierId: row.supplier_id,
        unitMode: priceRow.unit_mode,
      },
      stale,
    );

    if (!hit) {
      // 新口径没有价：成本保留旧值 + 标记缺价 + 转手填（对客价一分不动）
      lines.push({
        ...base,
        pricing_mode: 'auto',
        new_cost: null,
        new_sale: row.sale_unit_price,
        will_be_missing: true,
        new_price_id: null,
        changed: false,
      });
      line.costUnitPrice = row.cost_unit_price;
      continue;
    }

    const changed = hit.baseUnitPrice !== row.cost_unit_price || hit.priceId !== row.price_id;
    lines.push({
      ...base,
      pricing_mode: 'auto',
      new_cost: hit.baseUnitPrice,
      new_sale: row.sale_unit_price,
      will_be_missing: false,
      new_price_id: hit.priceId,
      changed,
    });
    line.costUnitPrice = hit.baseUnitPrice;
  }

  const before = calcQuote({ lines: items.map(toCalcLine), discountAmount: quote.discount_amount });
  const after = calcQuote({ lines: hypothetical, discountAmount: quote.discount_amount });

  return {
    lines,
    total_before: before.totalPrice,
    total_after: after.totalPrice,
    cost_before: before.totalCost,
    cost_after: after.totalCost,
    margin_before: before.marginRate === null ? null : before.marginRate.toFixed(4),
    margin_after: after.marginRate === null ? null : after.marginRate.toFixed(4),
    changed_lines: lines.filter((l) => l.changed).length,
    auto_priced_lines: lines.filter((l) => l.pricing_mode === 'auto').length,
    manual_priced_lines: lines.filter((l) => l.pricing_mode === 'manual').length,
    missing_after: lines.filter((l) => l.will_be_missing).length,
  };
}

export async function previewTaxBasis(id: string, newBasis: TaxBasis) {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (quote.status !== 'draft') {
    throw new AppError(40905, '已发出或已作废的报价单不能切换税口径。', 409);
  }
  const items = await listQuoteItemRows(id);
  const plan = await planTaxBasisSwitch(quote, items, newBasis);
  return {
    current_tax_statement: quote.tax_statement,
    target_tax_statement: newBasis,
    affected_lines: plan.lines
      .filter((l) => l.changed || l.will_be_missing || l.pricing_mode === 'manual')
      .map((l) => ({
        line_id: l.line_id,
        item_name_snapshot: l.item_name_snapshot,
        supplier_name_snapshot: l.supplier_name_snapshot,
        pricing_mode: l.pricing_mode,
        old_cost: l.old_cost,
        new_cost: l.new_cost,
        old_sale: l.old_sale,
        new_sale: l.new_sale,
        will_be_missing: l.will_be_missing,
        old_price_id: l.old_price_id,
        new_price_id: l.new_price_id,
      })),
    summary: {
      total_before: plan.total_before,
      total_after: plan.total_after,
      cost_before: plan.cost_before,
      cost_after: plan.cost_after,
      margin_before: plan.margin_before,
      margin_after: plan.margin_after,
      changed_lines: plan.changed_lines,
      auto_priced_lines: plan.auto_priced_lines,
      manual_priced_lines: plan.manual_priced_lines,
      missing_after: plan.missing_after,
    },
  };
}

/** 落库：与 previewTaxBasis 用同一个 planTaxBasisSwitch，保证提示与实际一致 */
export async function patchQuoteTaxBasis(id: string, newBasis: TaxBasis): Promise<void> {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (quote.status !== 'draft') {
    throw new AppError(40905, '已发出或已作废的报价单不能切换税口径。', 409);
  }
  if (quote.tax_statement === newBasis) return;
  const items = await listQuoteItemRows(id);
  const plan = await planTaxBasisSwitch(quote, items, newBasis);

  await tx(async (c) => {
    for (const l of plan.lines) {
      if (l.will_be_missing) {
        await c.query(
          `UPDATE quote_items
              SET cost_source = 'manual', price_missing = true, price_id = NULL, tax_included = $2
            WHERE id = $1`,
          [l.line_id, newBasis === 'inclusive'],
        );
      } else if (l.changed) {
        await c.query(
          `UPDATE quote_items
              SET cost_unit_price = $2, price_id = $3, price_missing = false, tax_included = $4
            WHERE id = $1`,
          [l.line_id, l.new_cost, l.new_price_id, newBasis === 'inclusive'],
        );
      }
    }
    await c.query('UPDATE quotes SET tax_statement = $2, updated_at = now() WHERE id = $1', [id, newBasis]);
    await recalcAndPersist(c, id);
  });
}
