import {
  body, ok, optDate, optDecimal, optStr, requireCreatePrice, requireUser, reqDate, reqDecimal, reqStr, reqUuid, searchParams,
} from '@/server/http';
import { dateParam, enumParam, pageQuery } from '@/server/params';
import { route } from '@/server/wrap';
import { createPrice, type PriceTierInput } from '@/server/services/price-write.service';
import { listPriceDtos } from '@/server/services/price-read.service';

export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const page = pageQuery(sp);
  const itemId = sp.get('item_id');
  const supplierId = sp.get('supplier_id');
  return ok(
    await listPriceDtos({
      itemId: itemId ? reqUuid(itemId, 'item_id') : null,
      supplierId: supplierId ? reqUuid(supplierId, 'supplier_id') : null,
      status: enumParam(sp, 'status', ['active', 'superseded', 'archived'] as const),
      from: dateParam(sp, 'from'),
      to: dateParam(sp, 'to'),
      page,
    }),
  );
});

/**
 * 新建价格。admin 与 member 都能录（录价意愿是这套系统的命门），
 * 但改旧价只有 admin —— 两个判定故意分开，不合并成 canEditPrice。
 */
export const POST = route(async (req) => {
  const actor = await requireCreatePrice();
  const b = await body<Record<string, unknown>>(req);
  const tiersRaw = Array.isArray(b.tiers) ? (b.tiers as Array<Record<string, unknown>>) : [];
  const tiers: PriceTierInput[] = tiersRaw.map((t) => ({
    min_qty: reqDecimal(t.min_qty, 'tiers.min_qty'),
    unit_price: reqDecimal(t.unit_price, 'tiers.unit_price'),
  }));
  const created = await createPrice(actor, {
    item_id: reqStr(b.item_id, '计价主体', 40),
    supplier_id: reqStr(b.supplier_id, '供应商', 40),
    unit_code: reqStr(b.unit_code, '单位', 20),
    pricing_nature: optStr(b.pricing_nature, 20) ?? '',
    unit_price: reqDecimal(b.unit_price, '单价'),
    effective_from: reqDate(b.effective_from, '生效日'),
    base_unit_qty: optDecimal(b.base_unit_qty, '折算系数'),
    currency: optStr(b.currency, 3) ?? 'CNY',
    tax_included: b.tax_included === undefined ? true : Boolean(b.tax_included),
    tax_rate: optDecimal(b.tax_rate, '税率'),
    moq: optDecimal(b.moq, '起订量'),
    effective_to: optDate(b.effective_to, '失效日'),
    source_note: optStr(b.source_note, 200),
    tiers,
    close_previous: b.close_previous === true,
  });
  return ok(created, 201);
});
