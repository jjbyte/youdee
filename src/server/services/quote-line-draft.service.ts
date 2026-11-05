/**
 * 行草稿的构建：把「用户给了什么」翻译成「quote_items 一整行快照」。
 *
 * 一条铁律：金额只在这里算一次（domain/quote-calc），落表后不再回头改。
 * 前端传来的 line_cost / line_price 一律忽略 —— 让前端能传金额，
 * 就等于让"两张单金额不一致"成为可能，而这类问题通常在客户对账时才被发现。
 */
import type { PoolClient } from 'pg';
import { today } from '../db';
import { AppError } from '../http';
import { applyTargetMargin, calcLine } from '@/domain/quote-calc';
import type { QuoteRow } from '../store/quotes.store';
import { referenceLowest, resolveOne } from './lookup.service';
import {
  loadItemBrief,
  loadPriceBrief,
  type PriceBrief,
  type QuoteItemInput,
  type RowDraft,
} from './quote-line-input';

/**
 * 成本来源的三条合法路径：
 *   ① 手填（cost_source=manual）→ cost_unit_price 必填，缺失是 40002 而不是"当 0 算"
 *   ② 指定 price_id → 按本行数量命中阶梯，并归一为比价基准单位单价
 *   ③ 只给 item_id → 自动取「同性质同口径同计价方式」当日的价（不是全局最低）
 */
async function resolveDraftCost(
  quote: QuoteRow,
  input: QuoteItemInput,
  stale: number,
): Promise<{ draft: Partial<RowDraft> }> {
  const source = input.cost_source;
  if (source !== 'price_book' && source !== 'manual') {
    throw new AppError(40001, '成本来源只能是 price_book 或 manual，必传。', 400, { field: 'cost_source' });
  }
  if (source === 'manual') {
    if (!input.cost_unit_price) {
      throw new AppError(40002, '这行选择了手填成本，但没有填成本单价。', 400, { field: 'cost_unit_price' });
    }
    return {
      draft: {
        cost_source: 'manual',
        price_missing: !input.price_id,
        cost_unit_price: input.cost_unit_price,
        tax_included: quote.tax_statement === 'inclusive',
      },
    };
  }

  if (input.cost_unit_price) {
    return {
      draft: {
        cost_source: 'price_book',
        price_missing: false,
        cost_unit_price: input.cost_unit_price,
        tax_included: quote.tax_statement === 'inclusive',
      },
    };
  }

  const priceId = input.price_id ?? null;
  const itemId = input.item_id ?? null;
  let nature = input.pricing_nature ?? null;
  let unitMode: string | null = null;
  let supplierId = input.supplier_id ?? null;
  let priceBrief: PriceBrief | null = null;

  if (priceId) {
    priceBrief = await loadPriceBrief(priceId);
    if (!priceBrief) throw new AppError(40401, '这条价格不存在。', 404);
    nature = priceBrief.pricing_nature;
    unitMode = priceBrief.unit_mode;
    supplierId = priceBrief.supplier_id;
  }
  const effectiveItemId = itemId ?? priceBrief?.item_id ?? null;
  if (!effectiveItemId || !nature) {
    throw new AppError(
      40001,
      '价格库来源的行需要给出 price_id 或（item_id + pricing_nature），否则取不到成本。',
      400,
      { field: 'price_id' },
    );
  }

  const hit = await resolveOne(
    {
      itemId: effectiveItemId,
      qty: input.qty,
      pricingNature: nature,
      taxBasis: quote.tax_statement === 'inclusive' ? 'inclusive' : 'exclusive',
      onDate: today(),
      supplierId,
      unitMode,
    },
    stale,
  );
  if (!hit) {
    throw new AppError(
      42205,
      `这个主体在${quote.tax_statement === 'inclusive' ? '含税' : '不含税'}口径下、今天没有可用的价格。`
        + '请改用手填成本，或先让供应商补一条价。',
      422,
      { detail: { item_id: effectiveItemId, pricing_nature: nature, tax_basis: quote.tax_statement, on_date: today() } },
    );
  }

  return {
    draft: {
      cost_source: 'price_book',
      price_missing: false,
      cost_unit_price: hit.baseUnitPrice,
      tax_included: hit.taxIncluded,
      price_id: hit.priceId,
      supplier_id: hit.supplierId,
      supplier_name_snapshot: hit.supplierName,
      pricing_nature: nature,
      reference_lowest_price: hit.baseUnitPrice,
      reference_lowest_supplier_id: hit.supplierId,
    },
  };
}

export async function buildDraft(quote: QuoteRow, input: QuoteItemInput, stale: number): Promise<RowDraft> {
  const item = input.item_id ? await loadItemBrief(input.item_id) : null;
  const resolved = await resolveDraftCost(quote, input, stale);

  const costUnitPrice = resolved.draft.cost_unit_price;
  if (!costUnitPrice) {
    throw new AppError(40002, '成本单价为空。', 400, { field: 'cost_unit_price' });
  }

  let saleUnitPrice = input.sale_unit_price ?? null;
  if (saleUnitPrice === null) {
    if (!quote.target_margin_rate) {
      throw new AppError(
        40001,
        '这行没有给对客单价，这张单也没有设目标毛利率，无法反推。请填对客价或在单头设目标毛利率。',
        400,
        { field: 'sale_unit_price' },
      );
    }
    saleUnitPrice = applyTargetMargin(costUnitPrice, Number(quote.target_margin_rate));
  }

  const nature = resolved.draft.pricing_nature ?? input.pricing_nature ?? null;
  let refLowest = input.reference_lowest_price ?? resolved.draft.reference_lowest_price ?? null;
  let refSupplier = input.reference_lowest_supplier_id ?? resolved.draft.reference_lowest_supplier_id ?? null;
  if (!refLowest && item && nature) {
    const ref = await referenceLowest(
      item.id,
      nature,
      quote.tax_statement === 'inclusive',
      null,
      today(),
    );
    refLowest = ref.price;
    refSupplier = ref.supplierId;
  }

  const lineKind = input.line_kind;
  if (!['material', 'personnel', 'custom'].includes(lineKind)) {
    throw new AppError(40001, 'line_kind 只能是 material / personnel / custom。', 400, { field: 'line_kind' });
  }

  return {
    line_kind: lineKind,
    pricing_nature: nature,
    item_name_snapshot: input.item_name_snapshot?.trim() || item?.name || '未命名行',
    spec_snapshot: input.spec_snapshot ?? item?.spec ?? null,
    category_snapshot: input.category_snapshot ?? item?.category_name ?? null,
    unit_snapshot: input.unit_snapshot?.trim() || item?.base_unit_name || '项',
    supplier_name_snapshot: resolved.draft.supplier_name_snapshot ?? input.supplier_name_snapshot ?? null,
    qty: input.qty,
    cost_unit_price: costUnitPrice,
    sale_unit_price: saleUnitPrice,
    cost_source: resolved.draft.cost_source ?? 'manual',
    price_missing: resolved.draft.price_missing ?? true,
    reference_lowest_price: refLowest,
    reference_lowest_supplier_id: refSupplier,
    tax_included: resolved.draft.tax_included ?? (quote.tax_statement === 'inclusive'),
    item_id: input.item_id ?? null,
    price_id: resolved.draft.price_id ?? input.price_id ?? null,
    supplier_id: resolved.draft.supplier_id ?? input.supplier_id ?? null,
    is_visible_to_customer: input.is_visible_to_customer ?? true,
    /**
     * 行备注的初值来自物料/人员自己的备注（"报价含运输不含电费"这类），
     * 到了这一行就是**这一行的快照**：之后在物料库里改备注，不影响已经录进来的行；
     * 在单子里改行备注，也不回写物料库。三处各是各的。
     *
     * 用 `!== undefined` 而不是 `??`：清空备注传的是 null，
     * 用 `??` 会把 null 当成"没传"，于是被物料备注重新填回来——清不掉。
     */
    note: input.remark !== undefined ? input.remark : (item?.note ?? null),
  };
}

export async function insertRow(
  c: PoolClient,
  quoteId: string,
  draft: RowDraft,
  sortOrder: number,
): Promise<string> {
  const line = calcLine({
    qty: draft.qty,
    costUnitPrice: draft.cost_unit_price,
    saleUnitPrice: draft.sale_unit_price,
    costSource: draft.cost_source,
    referenceLowestPrice: draft.reference_lowest_price,
    isVisibleToCustomer: draft.is_visible_to_customer,
  });
  const r = await c.query<{ id: string }>(
    `INSERT INTO quote_items (
        quote_id, sort_order, line_kind, pricing_nature, item_name_snapshot, spec_snapshot,
        category_snapshot, unit_snapshot, supplier_name_snapshot, qty, cost_unit_price, sale_unit_price,
        line_cost, line_price, line_profit, line_margin, cost_source, price_missing,
        reference_lowest_price, reference_lowest_supplier_id, tax_included,
        item_id, price_id, supplier_id, is_visible_to_customer, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     RETURNING id`,
    [
      quoteId,
      sortOrder,
      draft.line_kind,
      draft.pricing_nature,
      draft.item_name_snapshot,
      draft.spec_snapshot,
      draft.category_snapshot,
      draft.unit_snapshot,
      draft.supplier_name_snapshot,
      draft.qty,
      draft.cost_unit_price,
      draft.sale_unit_price,
      line.lineCost,
      line.linePrice,
      line.lineProfit,
      (line.lineMargin ?? 0).toFixed(4),
      draft.cost_source,
      draft.price_missing,
      draft.reference_lowest_price,
      draft.reference_lowest_supplier_id,
      draft.tax_included,
      draft.item_id,
      draft.price_id,
      draft.supplier_id,
      draft.is_visible_to_customer,
      draft.note,
    ],
  );
  return r.rows[0]!.id;
}
