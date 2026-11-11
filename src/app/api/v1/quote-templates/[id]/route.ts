import { body, ok, optStr, reqUuid, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteTemplate, patchTemplate } from '@/server/services/templates.service';

export const PATCH = route(async (req, params) => {
  const actor = await requireAdmin('修改报价单模板');
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  return ok(
    await patchTemplate(
      id,
      {
        name: b.name === undefined ? undefined : String(b.name),
        // 供应商名称允许清空（空串是"还没填"，不是"不改"）
        supplier_name: b.supplier_name === undefined ? undefined : (optStr(b.supplier_name, 120) ?? ''),
        // reset_layout：退回系统默认版式（不删模板，只是不再用上传的那份）
        ...(b.reset_layout === true ? { layout: null, source_file: null } : {}),
        is_default: b.is_default === undefined ? undefined : b.is_default === true,
        is_active: b.is_active === undefined ? undefined : b.is_active !== false,
        sort_order: b.sort_order === undefined ? undefined : Number(b.sort_order),
      },
      actor,
    ),
  );
});

/** 真删：历史单上的供应商名是快照，删模板不会让老单少印一行 */
export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除报价单模板');
  return ok(await deleteTemplate(reqUuid(params.id, 'id')));
});
