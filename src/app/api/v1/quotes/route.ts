import { body, ok, optDate, optDecimal, optStr, optUuid, requireUser, reqDate, reqStr, searchParams } from '@/server/http';
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
  status: 'q.status',
};

/**
 * 默认顺序：**草稿优先**，组内按最后编辑倒序。
 *
 * 进报价单页面最常做的一件事是"接着把没做完的单做完"，草稿埋在已发出的单
 * 中间就等于每次都要先筛一遍。按状态分组、组内按最近编辑，第一屏就是他要找的那张。
 * 客户点名要的就是这句：「显示全部状态的报价单，按状态排序草稿优先」。
 *
 * 注意不能写成 `sortClause(sp, SORTABLE, 这个多键表达式)`——sortClause 会在
 * 表达式后面再拼一个 DESC，变成 `... END, q.updated_at DESC DESC`，SQL 直接报错。
 */
const DEFAULT_ORDER = `CASE q.status WHEN 'draft' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, q.updated_at DESC`;

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
      orderBy: sp.get('sort') ? sortClause(sp, SORTABLE, 'q.created_at') : DEFAULT_ORDER,
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
    template_id: optUuid(b.template_id, '报价单模板'),
  });
  return ok(created, 201);
});
