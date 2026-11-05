import { body, ok, optStr, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deactivateUser, patchUser } from '@/server/services/users.service';

export const PATCH = route(async (req, params) => {
  const actor = await requireAdmin('修改账号');
  const id = reqUuid(params.id, 'id');
  const b = await body<{ name?: string; display_name?: string; role?: string; is_active?: boolean; password?: string; phone?: string | null }>(req);
  const updated = await patchUser(
    id,
    {
      name: b.name !== undefined || b.display_name !== undefined ? (optStr(b.name ?? b.display_name, 40) ?? undefined) : undefined,
      role: b.role,
      is_active: b.is_active,
      password: b.password,
      // 三态：不传 = 不动；null / '' = 清空；有值 = 校验后写入
      phone: b.phone === undefined ? undefined : optStr(b.phone, 30),
    },
    actor,
  );
  return ok(updated);
});

export const DELETE = route(async (_req, params) => {
  const actor = await requireAdmin('停用账号');
  const id = reqUuid(params.id, 'id');
  return ok(await deactivateUser(id, actor));
});
