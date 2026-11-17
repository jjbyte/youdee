import { ok, requireContractAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteContractFile } from '@/server/services/contract.service';

/** 删一份扫描件：谁都能删（与上传同权限），删错了重新传一份即可 */
export const DELETE = route(async (_req, params) => {
  await requireContractAccess();
  return ok(await deleteContractFile(reqUuid(params.id, 'id'), reqUuid(params.fileId, 'fileId')));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
