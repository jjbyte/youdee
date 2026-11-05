import { body, ok, optStr, requireAdmin, requireDelete, requireUser, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { getItemDetail } from '@/server/services/items-read.service';
import { deleteItem, itemDeleteImpact, patchItem } from '@/server/services/items-write.service';

export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await getItemDetail(reqUuid(params.id, 'id')));
});

export const PATCH = route(async (req, params) => {
  await requireAdmin('修改计价主体');
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchItem(id, {
    item_type: b.item_type === undefined ? undefined : reqStr(b.item_type, '主体类型', 20),
    category_id: b.category_id === undefined ? undefined : reqStr(b.category_id, '分类', 40),
    name: b.name === undefined ? undefined : reqStr(b.name, '名称', 80),
    base_unit_code: b.base_unit_code === undefined ? undefined : reqStr(b.base_unit_code, '基准单位', 20),
    compare_unit_code: b.compare_unit_code === undefined ? undefined : optStr(b.compare_unit_code, 20),
    spec: b.spec === undefined ? undefined : optStr(b.spec, 200),
    aliases: Array.isArray(b.aliases) ? (b.aliases as string[]).map((a) => String(a)) : undefined,
    includes_travel: b.includes_travel === undefined ? undefined : Boolean(b.includes_travel),
    is_active: b.is_active === undefined ? undefined : Boolean(b.is_active),
  });
  return ok(updated);
});

/**
 * 真删除：仅管理员，连带删掉这个主体自己的价。
 *
 * 0.1.12 及以前这个方法接的是"停用"——名字叫 DELETE、行为却是停用，
 * 管理员以为删干净了，其实还在库里躺着，只是被列表过滤掉了。
 * 现在 DELETE 就是删，停用/作废走 /archive。
 */
export const DELETE = route(async (_req, params) => {
  await requireDelete('删除计价主体');
  const id = reqUuid(params.id, 'id');
  // 先取影响面再删：返回值里带价格条数，前端用它显示"连带删掉 N 条价"
  const impact = await itemDeleteImpact(id);
  await deleteItem(id);
  return ok(impact);
});
