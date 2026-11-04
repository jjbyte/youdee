/**
 * 按目标毛利率批量反推对客价 + 整单重算自检。
 *
 * 与"增删改行"分开成文件：这两个动作改的是**整单**的对客价或校验整单自洽性，
 * 不新增也不删除任何行；混在一起会让"改一行"的路径读到整单批处理的代码。
 */
import { tx } from '../db';
import { applyTargetMargin, calcLine, calcQuote } from '@/domain/quote-calc';
import { parseMoney, parseQty } from '@/domain/money';
import type { CurrentUser } from '../auth/session';
import {
  getQuoteRow,
  listQuoteItemRows,
  recalcAndPersist,
  toCalcLine,
  totalsDto,
} from '../store/quotes.store';
import { AppError } from '../http';
import { requireDraft } from './quote-line.service';

export async function applyMargin(quoteId: string, itemIds: string[] | null) {
  const quote = await requireDraft(quoteId);
  if (!quote.target_margin_rate) {
    throw new AppError(40001, '这张单没有目标毛利率，无法反推对客价。请先在单头设置目标毛利率。', 400, {
      field: 'target_margin_rate',
    });
  }
  const rate = Number(quote.target_margin_rate);
  const rows = await listQuoteItemRows(quoteId);
  const targets = itemIds ? rows.filter((r) => itemIds.includes(r.id)) : rows;
  const updated: Array<{ item_id: string; old_sale_unit_price: string; new_sale_unit_price: string }> = [];

  await tx(async (c) => {
    for (const row of targets) {
      const nextSale = applyTargetMargin(row.cost_unit_price, rate);
      if (nextSale === row.sale_unit_price) continue;
      const line = calcLine({ ...toCalcLine(row), saleUnitPrice: nextSale });
      await c.query(
        `UPDATE quote_items SET sale_unit_price=$2, line_price=$3, line_profit=$4, line_margin=$5 WHERE id=$1`,
        [row.id, nextSale, line.linePrice, line.lineProfit, (line.lineMargin ?? 0).toFixed(4)],
      );
      updated.push({ item_id: row.id, old_sale_unit_price: row.sale_unit_price, new_sale_unit_price: nextSale });
    }
    await recalcAndPersist(c, quoteId);
  });

  const after = await getQuoteRow(quoteId);
  return { updated, quote_totals: totalsDto(after!) };
}

/**
 * 重算 = 自洽性检查：库内金额与重算不一致时修正，并把差异写进 warnings 说出来。
 * 不静默修：静默修等于把"有写入绕过了服务端计算"这条线索擦掉。
 */
export async function recalculate(quoteId: string, _actor: CurrentUser) {
  const drift = await tx(async (c) => {
    const r = await recalcAndPersist(c, quoteId);
    return r.drift;
  });
  const { quoteDetail } = await import('./quote.service');
  const detail = await quoteDetail(quoteId);
  const computed = calcQuote({
    lines: detail.items.map((i) => ({
      qty: i.qty,
      costUnitPrice: i.cost_unit_price,
      saleUnitPrice: i.sale_unit_price,
      costSource: i.cost_source as 'price_book' | 'manual',
      referenceLowestPrice: i.reference_lowest_price,
      isVisibleToCustomer: i.is_visible_to_customer,
    })),
    discountAmount: detail.discount_amount,
  });
  const warnings = [...drift];
  if (parseMoney(computed.totalPrice) !== parseMoney(detail.total_price)) {
    warnings.push('整单合计与重算结果不一致，已修正；这说明有写入绕过了服务端计算。');
  }
  if (parseQty(detail.items[0]?.qty ?? '0') < 0n) warnings.push('存在数量为负的行。');
  return { ...detail, warnings };
}
