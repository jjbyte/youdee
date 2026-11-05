import { body, boolParam, ok, optStr, requireAdmin, requireUser, reqStr, searchParams } from '@/server/http';
import { enumParam, pageQuery, sortClause } from '@/server/params';
import { route } from '@/server/wrap';
import { listItems } from '@/server/services/items-read.service';
import { createItem } from '@/server/services/items-write.service';

const SORTABLE: Record<string, string> = { name: 'i.name', created_at: 'i.created_at', updated_at: 'i.updated_at' };

export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const page = pageQuery(sp);
  const itemType = enumParam(sp, 'item_type', ['material', 'personnel'] as const);
  const categoryId = sp.get('category_id');
  const supplierId = sp.get('supplier_id');
  return ok(
    await listItems({
      itemType,
      q: (sp.get('q') ?? '').trim() || null,
      categoryId: categoryId ? reqStr(categoryId, 'category_id', 40) : null,
      supplierId: supplierId ? reqStr(supplierId, 'supplier_id', 40) : null,
      /**
       * 三态：不传 = 只看在用的（默认）；false = 只看已作废；all = 全看。
       * `all` 是为「作废/恢复」这个动作用的：要恢复一条，先得看得见它。
       */
      isActive: sp.get('is_active') === 'all' ? null : (boolParam(sp, 'is_active') ?? true),
      orderBy: sortClause(sp, SORTABLE, 'i.name'),
      limit: page.limit,
      offset: page.offset,
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireAdmin('新建计价主体');
  const b = await body<Record<string, unknown>>(req);
  const created = await createItem(actor, {
    item_type: reqStr(b.item_type, '主体类型', 20),
    category_id: reqStr(b.category_id, '分类', 40),
    name: reqStr(b.name, '名称', 80),
    base_unit_code: reqStr(b.base_unit_code, '基准单位', 20),
    compare_unit_code: optStr(b.compare_unit_code, 20),
    spec: optStr(b.spec, 200),
    aliases: Array.isArray(b.aliases) ? (b.aliases as string[]).map((a) => String(a)) : [],
    includes_travel: b.includes_travel === undefined ? null : Boolean(b.includes_travel),
    is_active: b.is_active === undefined ? true : Boolean(b.is_active),
  });
  return ok(created, 201);
});
