import { body, ok, optStr, requireAdmin, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { addLink } from '@/server/services/items-media.service';

export const POST = route(async (req, params) => {
  await requireAdmin('新增外链');
  const itemId = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const created = await addLink(itemId, {
    label: reqStr(b.label, '链接名称', 60),
    url: reqStr(b.url, '链接地址', 1000),
    sortOrder: b.sort_order === undefined ? 0 : Number(b.sort_order),
  });
  return ok({ ...created, note: optStr(b.note, 200) }, 201);
});
