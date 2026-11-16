import { body, ok, requireAdmin, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteInvoice, getInvoice, patchInvoice } from '@/server/services/invoice.service';

/**
 * 发票详情 / 编辑 / 软删。
 *
 * GET：管理员可以打开已删除的那张（决定要不要恢复）；成员看不到。
 * PATCH：任意可编辑字段（部分更新）。`status` 也收，但只有管理员能提——
 *   成员提了回 403 而不是静默忽略（静默忽略会让成员以为改成功了，
 *   然后拿着一张没冲红的票去对账）。
 * DELETE：仅管理员，且是**软删**——票是凭据，扫描件常是唯一副本，恢复后必须还在。
 */
export const GET = route(async (_req, params) => {
  const actor = await requireUser();
  const id = reqUuid(params.id, 'id');
  return ok(await getInvoice(id, { includeDeleted: actor.role === 'admin' }));
});

export const PATCH = route(async (req, params) => {
  const actor = await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  return ok(await patchInvoice(id, b, actor));
});

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除发票');
  return ok(await deleteInvoice(reqUuid(params.id, 'id')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
