import { AppError, body, ok, requireContractAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { setContractStatus } from '@/server/services/contract.service';
import { isContractStatus } from '@/domain/contract';

/**
 * 改合同状态 —— **唯一写入路径**（`PATCH /contracts/:id` 故意不收 status）。
 *
 * 两处都收的后果：抽屉保存时顺手把 status 一起提交，新建时的默认值就会覆盖
 * 别人手工改过的状态，而界面上看不出任何异常。所以状态只有这一个入口。
 *
 * 五态任意切换、不设状态机（业务方明确要求：他们就是会改主意），
 * 只在 `updated_at` 上留痕。非法值 400，**不静默回落**。
 *
 * 权限：随合同模块（仅管理员）。曾经是"登录即可"——理由是改状态可逆、不动金额；
 * 但 2026-11-17 客户把整个合同模块收成管理员专属，这里跟着收，不留独立口径。
 */
export const PATCH = route(async (req, params) => {
  await requireContractAccess();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ status?: unknown }>(req);
  if (!isContractStatus(b.status)) {
    throw new AppError(
      40001,
      '合同状态只能是签订中（negotiating）/ 履约中（performing）/ 结算中（settling）/ 已结算（settled）/ 已终止（terminated）。',
      400,
      { field: 'status' },
    );
  }
  return ok(await setContractStatus(id, b.status));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
