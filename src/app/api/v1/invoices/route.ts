import { body, ok, requireUser, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { createInvoice, listInvoices, parseInvoiceListQuery } from '@/server/services/invoice.service';

/**
 * 发票台账（GET 列表 / POST 手工录入）。
 *
 * 读：任何登录用户。台账不给看就等于没有台账。
 * 写：任何登录用户。录入是行政活，卡在管理员身上会变成"管理员不在就录不进"。
 * 改状态 / 删除：仅管理员（见 [id]/status 与 [id]），因为冲红会翻转金额符号。
 *
 * 查询维度照财务在 Excel 里翻的那几列：号码（精确）/ 代码 / 购买方 / 销售方（模糊）/
 * 开票日期区间 / 状态 / 是否已有原件 / 挂了哪份合同。`q` 是兜底：五个字段一起模糊。
 *
 * 响应带 `summary`：一次窗口聚合扫描同时得到本页行与全量合计（见 invoice-dto）。
 */
export const GET = route(async (req) => {
  const actor = await requireUser();
  const sp = searchParams(req);
  return ok(await listInvoices(parseInvoiceListQuery(sp, { allowDeleted: actor.role === 'admin' })));
});

/** 手工录入：没有原件，只把票面数字记下来（识别失败时的第二出口） */
export const POST = route(async (req) => {
  const actor = await requireUser();
  const b = await body<Record<string, unknown>>(req);
  return ok(await createInvoice(b, actor), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
