import { body, ok, optDate, optDecimal, optStr, requireUser, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteQuote, patchQuote, quoteDetail } from '@/server/services/quote.service';

export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await quoteDetail(reqUuid(params.id, 'id')));
});

export const PATCH = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchQuote(id, {
    customer_name: b.customer_name === undefined ? undefined : reqStr(b.customer_name, '客户名称', 80),
    event_name: b.event_name === undefined ? undefined : reqStr(b.event_name, '活动名称', 120),
    event_date: b.event_date === undefined ? undefined : optDate(b.event_date, '活动日期'),
    valid_until: b.valid_until === undefined ? undefined : reqStr(b.valid_until, '报价有效期', 10),
    project_type: b.project_type === undefined ? undefined : optStr(b.project_type, 30),
    target_margin_rate: b.target_margin_rate === undefined ? undefined : optDecimal(b.target_margin_rate, '目标毛利率'),
    discount_amount: b.discount_amount === undefined ? undefined : optDecimal(b.discount_amount, '优惠金额'),
    note: b.note === undefined ? undefined : optStr(b.note, 2000),
    tax_statement: b.tax_statement === 'inclusive' || b.tax_statement === 'exclusive' ? b.tax_statement : undefined,
  });
  return ok(updated);
});

/** 删除：仅管理员，任意状态（软删，台账仍可在库里查证）。成员请用「作废」 */
export const DELETE = route(async (_req, params) => {
  const actor = await requireUser();
  await deleteQuote(reqUuid(params.id, 'id'), actor);
  return ok(null);
});
