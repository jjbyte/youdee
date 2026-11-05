import { body, boolParam, ok, optLoose, optStr, requireAdmin, requireUser, reqStr, searchParams } from '@/server/http';
import { enumParam, pageQuery, sortClause } from '@/server/params';
import { route } from '@/server/wrap';
import { SUPPLIER_TYPES } from '@/domain/units';
import { createSupplier, listSuppliers } from '@/server/services/suppliers.service';

const SORTABLE: Record<string, string> = { name: 'name', type: 'type', created_at: 'created_at', updated_at: 'updated_at' };

export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const page = pageQuery(sp);
  return ok(
    await listSuppliers({
      q: (sp.get('q') ?? '').trim() || null,
      type: enumParam(sp, 'type', SUPPLIER_TYPES),
      isActive: boolParam(sp, 'is_active') ?? null,
      orderBy: sortClause(sp, SORTABLE, 'name'),
      limit: page.limit,
      offset: page.offset,
    }),
  );
});

export const POST = route(async (req) => {
  await requireAdmin('新建供应商');
  const b = await body<Record<string, unknown>>(req);
  const created = await createSupplier({
    name: reqStr(b.name, '供应商名称', 80),
    type: reqStr(b.type, '供应商类型', 20),
    contact_name: optStr(b.contact_name, 30),
    contact_phone: optStr(b.contact_phone, 30),
    shop_url: optStr(b.shop_url, 500),
    region: optStr(b.region, 50),
    default_lead_time_days: b.default_lead_time_days === null || b.default_lead_time_days === undefined ? null : Number(b.default_lead_time_days),
    note: optStr(b.note, 500),
    is_active: b.is_active === undefined ? true : Boolean(b.is_active),
    // 开票信息：新建时一般不填（快速建档），但接口与编辑页同一套规则
    tax_no: optLoose(b.tax_no),
    company_address: optLoose(b.company_address),
    company_phone: optLoose(b.company_phone),
    bank_name: optLoose(b.bank_name),
    bank_account: optLoose(b.bank_account),
  });
  return ok(created, 201);
});
