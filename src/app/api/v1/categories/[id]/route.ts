import { body, ok, optStr, requireAdmin, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteCategory, patchCategory } from '@/server/services/categories.service';

export const PATCH = route(async (req, params) => {
  await requireAdmin('修改分类');
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchCategory(id, {
    name: b.name === undefined ? undefined : reqStr(b.name, '分类名称', 30),
    parent_id: b.parent_id === undefined ? undefined : (b.parent_id === null ? null : reqStr(b.parent_id, '父分类', 40)),
    sort_order: b.sort_order === undefined ? undefined : Number(b.sort_order),
    default_pricing_nature: b.default_pricing_nature === undefined ? undefined : optStr(b.default_pricing_nature, 20),
  });
  return ok(updated);
});

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除分类');
  await deleteCategory(reqUuid(params.id, 'id'));
  return ok(null);
});
