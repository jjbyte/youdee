import { AppError, body, ok, requireUser, reqUuid } from '@/server/http';
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
 * 权限：登录即可。改状态是可逆的展示字段，不改金额、不改凭据。
 */
export const PATCH = route(async (req, params) => {
  await requireUser();
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
