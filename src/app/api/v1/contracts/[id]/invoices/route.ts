import { AppError, body, ok, requireContractAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { linkContractInvoices, listContractInvoices } from '@/server/services/contract-invoice.service';

/**
 * 合同 ↔ 发票。
 *
 * GET：这张合同挂了哪些票（软删的也返回，界面标灰 + 提示可恢复）。
 * POST：批量关联 1–200 个（`{ invoice_ids: [] }`）。**幂等**：
 *   复合主键 + `ON CONFLICT DO NOTHING`，同一次关联点两下不会出现两条一样的记录，
 *   返回的 `linked` 是真正新插进去的行数（前端不用自己数）。
 *
 * 权限：随合同模块（仅管理员）。关联本身是可逆动作，但它读的是发票台账，
 * 而发票台账对成员整块关闭——所以这里不能"登录即可"，否则就是一个绕过发票权限的洞。
 */
export const GET = route(async (_req, params) => {
  await requireContractAccess();
  const id = reqUuid(params.id, 'id');
  return ok({ items: await listContractInvoices(id) });
});

export const POST = route(async (req, params) => {
  const actor = await requireContractAccess();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ invoice_ids?: unknown }>(req);
  if (!Array.isArray(b.invoice_ids)) {
    throw new AppError(40001, '这一批关联要传 invoice_ids 数组。', 400, { field: 'invoice_ids' });
  }
  for (const raw of b.invoice_ids) reqUuid(raw, 'invoice_ids');
  return ok(await linkContractInvoices(id, b.invoice_ids as string[], actor), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
