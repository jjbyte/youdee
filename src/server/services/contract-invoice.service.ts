/**
 * 合同 ↔ 发票（多对多边表）。
 *
 * 为什么单独一个文件而不是塞进 contract.service：这一块的判重口径是**发票号**
 * 而不是合同，读写方向与合同附件完全不同（附件是 1:N，这里是 N:M）。
 * 混在一起的后果是 contract.service 里出现两套"这个 id 到底指合同还是发票"的上下文。
 *
 * 两条不变式：
 *   1. **幂等**：`contract_invoices` 复合主键 + `ON CONFLICT DO NOTHING`。
 *      同一次关联点两下不会出现两条一样的记录，前端不需要防抖，也不需要"先查后写"
 *      （先查后写在并发下照样能插进两条）。
 *   2. **软删的票仍然显示**：发票软删后关联保留（`CASCADE` 只在硬删时触发），
 *      合同详情里标灰并提示"这张票已被删除，可恢复"。把行藏起来会让用户以为
 *      "我明明关联过"。
 */
import type { QueryResultRow } from 'pg';
import { q, one } from '../db';
import { AppError } from '../http';
import { isInvoiceStatus, type InvoiceStatus } from '@/domain/invoice-record';
import type { CurrentUser } from '../auth/session';

/** 合同抽屉里显示的一行发票（够看够认，不带 ocr_raw 这类大字段） */
export interface LinkedInvoiceDTO {
  id: string;
  invoice_no: string;
  invoice_code: string;
  invoice_type: string;
  invoice_type_label: string;
  issued_on: string | null;
  seller_name: string;
  buyer_name: string;
  total_amount: string | null;
  status: InvoiceStatus;
  /** 发票被软删：关联还在，但界面要标灰 */
  deleted: boolean;
}

interface LinkedRow extends QueryResultRow {
  id: string;
  invoice_no: string;
  invoice_code: string;
  invoice_type: string;
  invoice_type_label: string;
  issued_on: string | null;
  seller_name: string;
  buyer_name: string;
  total_amount: string | null;
  status: string;
  deleted_at: Date | null;
}

const SELECT_LINKED = `
  SELECT i.id, i.invoice_no, i.invoice_code, i.invoice_type, i.invoice_type_label,
         i.issued_on, i.seller_name, i.buyer_name, i.total_amount, i.status, i.deleted_at
    FROM contract_invoices ci
    JOIN invoices i ON i.id = ci.invoice_id`;

function toLinkedDTO(r: LinkedRow): LinkedInvoiceDTO {
  return {
    id: r.id,
    invoice_no: r.invoice_no,
    invoice_code: r.invoice_code,
    invoice_type: r.invoice_type,
    invoice_type_label: r.invoice_type_label,
    issued_on: r.issued_on,
    seller_name: r.seller_name,
    buyer_name: r.buyer_name,
    // numeric 经 db.ts 已是字符串，原样带出
    total_amount: r.total_amount,
    status: isInvoiceStatus(r.status) ? r.status : 'normal',
    deleted: r.deleted_at !== null,
  };
}

/** 一张合同挂的发票（软删的也在列表里，由 `deleted` 标记） */
export async function listContractInvoices(contractId: string): Promise<LinkedInvoiceDTO[]> {
  const contract = await one<{ id: string }>('SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL', [contractId]);
  if (!contract) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);
  const rows = await q<LinkedRow>(
    `${SELECT_LINKED} WHERE ci.contract_id = $1
      ORDER BY i.issued_on DESC NULLS LAST, i.created_at DESC`,
    [contractId],
  );
  return rows.map(toLinkedDTO);
}

/**
 * 批量关联（1–200 个）。
 *
 * 返回的 `linked` 是**真正新插进去的行数**，不是提交的数量：
 * 前端据此提示"关联了 3 张，2 张之前就关联过"，而不用自己数。
 */
export async function linkContractInvoices(
  contractId: string,
  invoiceIds: string[],
  actor: CurrentUser,
): Promise<{ linked: number; items: LinkedInvoiceDTO[] }> {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new AppError(40001, '至少选中一张发票。', 400, { field: 'invoice_ids' });
  }
  if (invoiceIds.length > 200) {
    throw new AppError(40001, '一次最多关联 200 张，分批来。', 400, { field: 'invoice_ids' });
  }
  const contract = await one<{ id: string }>('SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL', [contractId]);
  if (!contract) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);

  // 软删的票不许再被关联（恢复之后再关联）。少这一步，就会出现"合同里挂着一张
  // 已经被删掉的票，点开 404"，而人是照着合同对账的。
  const alive = await q<{ id: string }>(
    'SELECT id FROM invoices WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
    [invoiceIds],
  );
  const aliveIds = new Set(alive.map((r) => r.id));
  const missing = invoiceIds.filter((id) => !aliveIds.has(id));
  if (missing.length === invoiceIds.length) {
    throw new AppError(40401, '选中的发票都不存在或已被删除，刷新一下列表重选。', 404);
  }
  if (missing.length > 0) {
    throw new AppError(
      40001,
      `有 ${missing.length} 张发票已被删除或不存在，先把它们从选择里去掉再关联。`,
      400,
      { field: 'invoice_ids', detail: { invalid_ids: missing } },
    );
  }

  const inserted = await q<{ invoice_id: string }>(
    `INSERT INTO contract_invoices (contract_id, invoice_id, created_by)
     SELECT $1, unnest($2::uuid[]), $3
     ON CONFLICT (contract_id, invoice_id) DO NOTHING
     RETURNING invoice_id`,
    [contractId, invoiceIds, actor.id],
  );
  return { linked: inserted.length, items: await listContractInvoices(contractId) };
}

export async function unlinkContractInvoice(contractId: string, invoiceId: string): Promise<{ deleted: true }> {
  const rows = await q<{ invoice_id: string }>(
    'DELETE FROM contract_invoices WHERE contract_id = $1 AND invoice_id = $2 RETURNING invoice_id',
    [contractId, invoiceId],
  );
  if (!rows[0]) throw new AppError(40401, '这条关联不存在，可能已经被取消了。', 404);
  return { deleted: true };
}

/** 发票详情里「已关联的合同」（与 `listContractInvoices` 是反方向） */
export async function listInvoiceContracts(invoiceId: string) {
  const rows = await q<{
    id: string;
    contract_no: string | null;
    title: string;
    company_name: string;
    project_name: string | null;
    status: string;
    deleted_at: Date | null;
  }>(
    `SELECT c.id, c.contract_no, c.title, c.company_name, c.project_name, c.status, c.deleted_at
       FROM contract_invoices ci
       JOIN contracts c ON c.id = ci.contract_id
      WHERE ci.invoice_id = $1
      ORDER BY c.signed_on DESC NULLS LAST, c.created_at DESC`,
    [invoiceId],
  );
  return rows;
}
