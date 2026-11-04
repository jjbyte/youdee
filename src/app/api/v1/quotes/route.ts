import { body, ok, optDate, optDecimal, optStr, requireUser, reqDate, reqStr, searchParams } from '@/server/http';
import { dateParam, enumParam, pageQuery, sortClause } from '@/server/params';
import { route } from '@/server/wrap';
import { createQuote, listQuotes } from '@/server/services/quote.service';
import { PROJECT_TYPES } from '@/domain/units';

const SORTABLE: Record<string, string> = {
  created_at: 'q.created_at',
  updated_at: 'q.updated_at',
  total_price: 'q.total_price',
  margin_rate: 'q.margin_rate',
  valid_until: 'q.valid_until',
};

export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const page = pageQuery(sp);
  return ok(
    await listQuotes({
      q: (sp.get('q') ?? '').trim() || null,
      status: enumParam(sp, 'status', ['draft', 'issued', 'void'] as const),
      projectType: enumParam(sp, 'project_type', PROJECT_TYPES),
      from: dateParam(sp, 'from'),
      to: dateParam(sp, 'to'),
      page,
      orderBy: sortClause(sp, SORTABLE, 'q.created_at'),
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireUser();
  const b = await body<Record<string, unknown>>(req);
  const created = await createQuote(actor, {
    customer_name: reqStr(b.customer_name, '客户名称', 80),
    event_name: reqStr(b.event_name, '活动名称', 120),
    valid_until: reqDate(b.valid_until, '报价有效期'),
    event_date: optDate(b.event_date, '活动日期'),
    project_type: optStr(b.project_type, 30),
    target_margin_rate: optDecimal(b.target_margin_rate, '目标毛利率'),
    discount_amount: optDecimal(b.discount_amount, '优惠金额'),
    note: optStr(b.note, 2000),
  });
  return ok(created, 201);
});
