import { ok, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { restoreContract } from '@/server/services/contract.service';

/** 恢复软删的合同：与删除同权限（管理员），扫描件一直在磁盘上，恢复即刻可见 */
export const POST = route(async (_req, params) => {
  await requireAdmin('恢复合同');
  return ok(await restoreContract(reqUuid(params.id, 'id')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
