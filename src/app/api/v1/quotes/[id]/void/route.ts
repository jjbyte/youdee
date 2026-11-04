import { body, ok, optStr, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { voidQuote } from '@/server/services/quote-actions.service';

export const POST = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ reason?: string }>(req).catch(() => ({ reason: undefined }));
  return ok(await voidQuote(id, optStr(b.reason, 200)));
});
