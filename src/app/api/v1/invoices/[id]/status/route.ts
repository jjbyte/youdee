import { AppError, body, ok, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setInvoiceStatus } from '@/server/services/invoice.service';
import { isInvoiceStatus } from '@/domain/invoice-record';

/**
 * 改发票状态（正常 / 冲红）—— **仅管理员**。
 *
 * 为什么单独一个端点而不是塞进 PATCH：
 *   冲红会把三项金额**翻转符号**，直接改「金额合计」这个对账数字。
 *   这类动作要么有第二个人看，要么不要让当天录票的人顺手做。
 *   单独一条路径，权限检查就只有一处，不会在将来某次重构里被"合并"掉。
 *
 * 改状态时金额同步重定符号（red → 负 / normal → 正），并置 `status_source='manual'`
 * ——之后同一张票重传，OCR 不再覆盖人工结论。
 *
 * 非法值 400（不静默回落）：静默回落的后果是"我明明点了冲红，合计却没变"。
 */
export const PATCH = route(async (req, params) => {
  await requireAdmin('改发票状态');
  const id = reqUuid(params.id, 'id');
  const b = await body<{ status?: unknown }>(req);
  if (!isInvoiceStatus(b.status)) {
    throw new AppError(40001, '发票状态只能是「正常」或「冲红」。', 400, { field: 'status' });
  }
  return ok(await setInvoiceStatus(id, b.status));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
