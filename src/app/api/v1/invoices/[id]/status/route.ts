import { AppError, body, ok, requireInvoiceAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setInvoiceStatus } from '@/server/services/invoice.service';
import { isInvoiceStatus } from '@/domain/invoice-record';

/**
 * 改发票状态（正常 / 已冲红）—— **仅管理员**。
 *
 * 这条路径改的是**标签**，不是金额：
 *   `red` = 这张蓝票已经被一张红字票冲掉了，别再拿它对账；
 *   抵账的负数由那张红字票自己带着（`is_red_letter`），所以这里**不碰三项金额**。
 *
 * 为什么仍然单独一个端点：它改的是"这张票还算不算数"这个判断，
 * 不是录入错误，混在 PATCH 里会跟着抽屉保存一路顺手提上来。
 * 单独一条路径，权限检查只有一处，不会在将来某次重构里被"合并"掉。
 *
 * 置 `status_source='manual'`：之后同一张票重传，OCR 不再覆盖人工结论。
 * 非法值 400（不静默回落）：静默回落的后果是"我明明点了已冲红，列表里还是正常"。
 */
export const PATCH = route(async (req, params) => {
  await requireInvoiceAccess();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ status?: unknown }>(req);
  if (!isInvoiceStatus(b.status)) {
    throw new AppError(40001, '发票状态只能是「正常」或「已冲红」。', 400, { field: 'status' });
  }
  return ok(await setInvoiceStatus(id, b.status));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
