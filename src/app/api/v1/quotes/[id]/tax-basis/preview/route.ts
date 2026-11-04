import { AppError, body, ok, requireUser, reqUuid, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { previewTaxBasis } from '@/server/services/tax.service';

function checkBasis(v: unknown): 'inclusive' | 'exclusive' {
  if (v === 'inclusive' || v === 'exclusive') return v;
  throw new AppError(40001, 'tax_statement 只能是 inclusive 或 exclusive。', 400, { field: 'tax_statement' });
}

/** 切口径试算：零副作用，只读。落库走 PATCH /quotes/:id，两者共用同一份计划 */
export const POST = route(async (req, params) => {
  await requireUser();
  const b = await body<{ tax_statement?: string }>(req);
  return ok(await previewTaxBasis(reqUuid(params.id, 'id'), checkBasis(b.tax_statement)));
});

export const GET = route(async (req, params) => {
  await requireUser();
  const sp = searchParams(req);
  return ok(await previewTaxBasis(reqUuid(params.id, 'id'), checkBasis(sp.get('tax_statement'))));
});
