import { body, ok, optStr, requireAdmin, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteLink, patchLink } from '@/server/services/items-media.service';

export const PATCH = route(async (req, params) => {
  await requireAdmin('修改外链');
  const itemId = reqUuid(params.id, 'id');
  const linkId = reqUuid(params.linkId, 'linkId');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchLink(itemId, linkId, {
    label: b.label === undefined ? undefined : optStr(b.label, 60),
    url: b.url === undefined ? undefined : reqStr(b.url, '链接地址', 1000),
  });
  return ok(updated);
});

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除外链');
  await deleteLink(reqUuid(params.id, 'id'), reqUuid(params.linkId, 'linkId'));
  return ok(null);
});
