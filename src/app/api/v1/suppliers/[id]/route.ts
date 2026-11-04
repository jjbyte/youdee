import { body, ok, optStr, requireAdmin, requireUser, reqStr, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteSupplier, getSupplier, patchSupplier } from '@/server/services/suppliers.service';

export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await getSupplier(reqUuid(params.id, 'id')));
});

export const PATCH = route(async (req, params) => {
  await requireAdmin('修改供应商');
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchSupplier(id, {
    name: b.name === undefined ? undefined : reqStr(b.name, '供应商名称', 80),
    type: b.type === undefined ? undefined : reqStr(b.type, '供应商类型', 20),
    contact_name: b.contact_name === undefined ? undefined : optStr(b.contact_name, 30),
    contact_phone: b.contact_phone === undefined ? undefined : optStr(b.contact_phone, 30),
    shop_url: b.shop_url === undefined ? undefined : optStr(b.shop_url, 500),
    region: b.region === undefined ? undefined : optStr(b.region, 50),
    default_lead_time_days: b.default_lead_time_days === undefined ? undefined : (b.default_lead_time_days === null ? null : Number(b.default_lead_time_days)),
    note: b.note === undefined ? undefined : optStr(b.note, 500),
    is_active: b.is_active === undefined ? undefined : Boolean(b.is_active),
  });
  return ok(updated);
});

export const DELETE = route(async (_req, params) => {
  await requireAdmin('删除供应商');
  await deleteSupplier(reqUuid(params.id, 'id'));
  return ok(null);
});
