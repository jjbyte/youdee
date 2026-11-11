import { body, ok, requireAdmin, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteContract, getContract, patchContract } from '@/server/services/contract.service';

export const GET = route(async (_req, params) => {
  const actor = await requireUser();
  const id = reqUuid(params.id, 'id');
  // 管理员可以打开已删除的合同看内容（决定要不要恢复）
  return ok(await getContract(id, { includeDeleted: actor.role === 'admin' }));
});

export const PATCH = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  return ok(await patchContract(id, b));
});

/** 软删：仅管理员，可恢复。真删会把唯一一份扫描件从台账里抹掉 */
export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除合同');
  return ok(await deleteContract(reqUuid(params.id, 'id')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
