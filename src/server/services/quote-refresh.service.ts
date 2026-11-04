/**
 * 草稿同步最新价（refresh-prices）。
 *
 * 三个刻意的克制：
 *   ① dry_run 必传且无默认值 —— 给它默认值就是替用户决定"要不要真的改金额"；
 *   ② 手填行默认跳过 —— 那些成本本来就不是价格库给的，覆盖它等于抹掉人填的数；
 *   ③ 新口径没有价时不清空旧值（no_valid_price），只在 skipped 里说出来。
 * 预览与落库共用同一段算术，preview_matches_write 用上次预览的签名比对。
 */
import { q, today, tx } from '../db';
import { AppError } from '../http';
import { calcLine } from '@/domain/quote-calc';
import { getQuoteRow, listQuoteItemRows, recalcAndPersist, type QuoteItemRow } from '../store/quotes.store';
import { staleDaysThreshold } from '../store/settings.store';
import { defaultUnitMode, resolveOne } from './lookup.service';

const lastPreview = new Map<string, string>();

export interface RefreshInput {
  itemIds: string[] | null;
  dryRun: boolean;
  includeManual: boolean;
}

interface ItemUnit {
  id: string;
  base_unit_code: string;
  compare_unit_code: string | null;
}

export async function refreshPrices(id: string, input: RefreshInput) {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (quote.status !== 'draft') {
    throw new AppError(40905, '只有草稿可以同步最新价。已发出的单引用的是当时的快照。', 409);
  }
  const items = await listQuoteItemRows(id);
  const targets = input.itemIds ? items.filter((r) => input.itemIds!.includes(r.id)) : items;
  const stale = await staleDaysThreshold();
  const onDate = today();

  const priceIds = targets.map((r) => r.price_id).filter((v): v is string => !!v);
  const priceRows = priceIds.length
    ? await q<{ id: string; pricing_nature: string; unit_mode: string | null }>(
        'SELECT id, pricing_nature, unit_mode FROM prices WHERE id = ANY($1::uuid[])',
        [priceIds],
      )
    : [];
  const priceMap = new Map(priceRows.map((p) => [p.id, p]));

  const itemIds = targets.map((r) => r.item_id).filter((v): v is string => !!v);
  const itemRows = itemIds.length
    ? await q<ItemUnit>(
        'SELECT id, base_unit_code, compare_unit_code FROM items WHERE id = ANY($1::uuid[])',
        [itemIds],
      )
    : [];
  const itemMap = new Map(itemRows.map((i) => [i.id, i]));

  const updated: Array<{
    item_id: string;
    item_name_snapshot: string;
    old_cost_unit_price: string;
    new_cost_unit_price: string;
    price_id: string;
    tax_included: boolean;
    cost_source: string;
  }> = [];
  const skipped: Array<{ item_id: string; item_name_snapshot: string | null; reason: string }> = [];

  for (const row of targets) {
    if (row.cost_source === 'manual' && !input.includeManual) {
      skipped.push({ item_id: row.id, item_name_snapshot: row.item_name_snapshot, reason: 'manual_cost' });
      continue;
    }
    if (!row.item_id) {
      skipped.push({ item_id: row.id, item_name_snapshot: row.item_name_snapshot, reason: 'not_found' });
      continue;
    }
    const p = row.price_id ? priceMap.get(row.price_id) : null;
    const nature = p?.pricing_nature ?? row.pricing_nature ?? 'purchase';
    const item = itemMap.get(row.item_id);
    const unitMode = p?.unit_mode ?? (item ? defaultUnitMode(item.base_unit_code, item.compare_unit_code) : null);

    const hit = await resolveOne(
      {
        itemId: row.item_id,
        qty: row.qty,
        pricingNature: nature,
        taxBasis: quote.tax_statement as 'inclusive' | 'exclusive',
        onDate,
        supplierId: row.supplier_id,
        unitMode,
      },
      stale,
    );
    if (!hit) {
      // 新价找不到时**不清空旧值**：清掉等于用"数据缺口"抹掉人已有的判断
      skipped.push({ item_id: row.id, item_name_snapshot: row.item_name_snapshot, reason: 'no_valid_price' });
      continue;
    }
    if (hit.baseUnitPrice === row.cost_unit_price && hit.priceId === row.price_id) {
      skipped.push({ item_id: row.id, item_name_snapshot: row.item_name_snapshot, reason: 'unchanged' });
      continue;
    }
    updated.push({
      item_id: row.id,
      item_name_snapshot: row.item_name_snapshot,
      old_cost_unit_price: row.cost_unit_price,
      new_cost_unit_price: hit.baseUnitPrice,
      price_id: hit.priceId,
      tax_included: hit.taxIncluded,
      cost_source: row.cost_source,
    });
  }

  const affectedManualCount = updated.filter((u) => u.cost_source === 'manual').length;
  const signature = JSON.stringify(updated.map((u) => [u.item_id, u.new_cost_unit_price]));

  if (input.dryRun) {
    lastPreview.set(id, signature);
    return {
      updated,
      skipped,
      dry_run: true,
      affected_manual_count: affectedManualCount,
      preview_matches_write: true,
    };
  }

  if (updated.length > 0) {
    const byId = new Map(targets.map((r) => [r.id, r]));
    await tx(async (c) => {
      for (const u of updated) {
        const row = byId.get(u.item_id) as QuoteItemRow;
        const line = calcLine({
          qty: row.qty,
          costUnitPrice: u.new_cost_unit_price,
          saleUnitPrice: row.sale_unit_price,
          costSource: row.cost_source as 'price_book' | 'manual',
          referenceLowestPrice: row.reference_lowest_price,
          isVisibleToCustomer: row.is_visible_to_customer,
        });
        await c.query(
          `UPDATE quote_items
              SET cost_unit_price=$2, price_id=$3, tax_included=$4, price_missing=false,
                  line_cost=$5, line_price=$6, line_profit=$7, line_margin=$8
            WHERE id=$1`,
          [
            row.id,
            u.new_cost_unit_price,
            u.price_id,
            u.tax_included,
            line.lineCost,
            line.linePrice,
            line.lineProfit,
            (line.lineMargin ?? 0).toFixed(4),
          ],
        );
      }
      await recalcAndPersist(c, id);
    });
  }

  const prev = lastPreview.get(id);
  return {
    updated,
    skipped,
    dry_run: false,
    affected_manual_count: affectedManualCount,
    preview_matches_write: prev === undefined ? true : prev === signature,
  };
}
