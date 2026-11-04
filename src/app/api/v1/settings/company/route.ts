import { body, ok, optStr, requireAdmin, requireUser, reqStr } from '@/server/http';
import { route } from '@/server/wrap';
import { getCompany, patchCompany } from '@/server/services/settings.service';

export const GET = route(async () => {
  await requireUser();
  return ok(await getCompany());
});

export const PATCH = route(async (req) => {
  const actor = await requireAdmin('修改公司抬头');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchCompany(
    {
      name: b.name === undefined ? undefined : reqStr(b.name, '公司名称', 100),
      address: b.address === undefined ? undefined : optStr(b.address, 200),
      phone: b.phone === undefined ? undefined : optStr(b.phone, 40),
      email: b.email === undefined ? undefined : optStr(b.email, 100),
      tax_no: b.tax_no === undefined ? undefined : optStr(b.tax_no, 40),
      bank_info: b.bank_info === undefined ? undefined : optStr(b.bank_info, 200),
      logo_url: b.logo_url === undefined ? undefined : optStr(b.logo_url, 500),
    },
    actor,
  );
  return ok(updated);
});
