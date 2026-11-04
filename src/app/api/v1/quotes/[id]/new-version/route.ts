import { body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { newVersion } from '@/server/services/quote-actions.service';

/** 改版重报：旧版冻结不覆盖，新版本是草稿 */
export const POST = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<{ copy_items?: boolean }>(req).catch(() => ({ copy_items: true }));
  return ok(await newVersion(id, b.copy_items !== false), 201);
});
