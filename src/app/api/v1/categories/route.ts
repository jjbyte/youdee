import { body, boolParam, ok, optStr, requireAdmin, requireUser, reqStr, searchParams } from '@/server/http';
import { enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { categoryTree, createCategory } from '@/server/services/categories.service';

/** 两域两棵树一起返回；默认带主体数（设置页要显示"这个分类下有几个主体"） */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const domain = enumParam(sp, 'domain', ['material', 'personnel'] as const);
  const includeCounts = boolParam(sp, 'include_counts') ?? true;
  return ok(await categoryTree(domain, includeCounts));
});

export const POST = route(async (req) => {
  await requireAdmin('新建分类');
  const b = await body<Record<string, unknown>>(req);
  const created = await createCategory({
    domain: reqStr(b.domain, '领域', 20),
    name: reqStr(b.name, '分类名称', 30),
    parent_id: b.parent_id === null || b.parent_id === undefined ? null : reqStr(b.parent_id, '父分类', 40),
    sort_order: b.sort_order === undefined ? 0 : Number(b.sort_order),
    default_pricing_nature: optStr(b.default_pricing_nature, 20),
  });
  return ok(created, 201);
});
