import { ok, requireInvoiceAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { restoreInvoice } from '@/server/services/invoice.service';

/**
 * 恢复已软删的发票（仅管理员）。
 *
 * 软删期间原件一字节没动，所以恢复后点开就能看到扫描件——
 * 这也是"删除只打 deleted_at"的唯一理由。
 */
export const POST = route(async (_req, params) => {
  await requireInvoiceAccess();
  return ok(await restoreInvoice(reqUuid(params.id, 'id')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
