import { body, ok, requireInvoiceAccess, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { createInvoice, listInvoices, parseInvoiceListQuery } from '@/server/services/invoice.service';

/**
 * 发票台账（GET 列表 / POST 手工录入）。
 *
 * 权限：**整块仅管理员**（2026-11-17 客户要求，读也拦）。
 * 一支路由一个人判：`requireInvoiceAccess()`。台里有价税与开票信息，属财务口径，
 * 成员不该拿它做二次核对；需要数字就找管理员要。
 *
 * 查询维度照财务在 Excel 里翻的那几列：号码（精确）/ 代码 / 购买方 / 销售方（模糊）/
 * 开票日期区间 / 状态 / 是否已有原件 / 挂了哪份合同。`q` 是兜底：五个字段一起模糊。
 *
 * 响应带 `summary`：一次窗口聚合扫描同时得到本页行与全量合计（见 invoice-dto）。
 */
export const GET = route(async (req) => {
  const actor = await requireInvoiceAccess();
  const sp = searchParams(req);
  return ok(await listInvoices(parseInvoiceListQuery(sp, { allowDeleted: actor.role === 'admin' })));
});

/** 手工录入：没有原件，只把票面数字记下来（识别失败时的第二出口） */
export const POST = route(async (req) => {
  const actor = await requireInvoiceAccess();
  const b = await body<Record<string, unknown>>(req);
  return ok(await createInvoice(b, actor), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
