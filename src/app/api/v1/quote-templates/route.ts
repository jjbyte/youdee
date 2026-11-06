import { body, ok, optStr, requireAdmin, requireUser, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { createTemplate, listTemplates } from '@/server/services/templates.service';

/**
 * 报价单模板。
 *
 * GET 任何登录用户都能读：新建报价单的下拉要它，成员也要建单。
 * 写操作只有管理员 —— 模板决定客户看到的供应商名称，一个人就能改等于没有管控。
 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const activeOnly = sp.get('active_only') === '1' || sp.get('active_only') === 'true';
  return ok({ items: await listTemplates({ activeOnly }) });
});

export const POST = route(async (req) => {
  const actor = await requireAdmin('新建报价单模板');
  const b = await body<Record<string, unknown>>(req);
  const created = await createTemplate(
    {
      name: String(b.name ?? ''),
      supplier_name: optStr(b.supplier_name, 120) ?? '',
      is_default: b.is_default === true,
      is_active: b.is_active !== false,
      sort_order: b.sort_order === undefined ? undefined : Number(b.sort_order),
    },
    actor,
  );
  return ok(created, 201);
});
