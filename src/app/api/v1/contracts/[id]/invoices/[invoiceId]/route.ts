import { ok, requireContractAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { unlinkContractInvoice } from '@/server/services/contract-invoice.service';

/**
 * 解除合同与发票的关联。
 *
 * 只删这条边，发票本身一行不动（`contract_invoices` 的 CASCADE 只在硬删时触发）。
 * 这也是"关联 / 解除"敢对所有登录用户开放的理由：动作可逆，不会伤到台账。
 */
export const DELETE = route(async (_req, params) => {
  await requireContractAccess();
  const contractId = reqUuid(params.id, 'id');
  const invoiceId = reqUuid(params.invoiceId, 'invoiceId');
  return ok(await unlinkContractInvoice(contractId, invoiceId));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
