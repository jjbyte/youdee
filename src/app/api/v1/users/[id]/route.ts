import { body, ok, optStr, requireAdmin, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { deleteUser, deactivateUser, patchUser } from '@/server/services/users.service';

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

/**
 * DELETE 有两种语义，靠 `?hard=1` 区分：
 *   · 默认 = 停用（可逆，历史单据署名保留）
 *   · hard=1 = 真删（不可逆；只能删成员，且名下不能有报价单）
 *
 * 不做成两个端点：调用方都是"把这个人从列表里弄走"，差别只在最后一步要不要留痕，
 * 放在同一个路径上少一个需要同步维护的权限判断。
 */
export const DELETE = route(async (req, params) => {
  const id = reqUuid(params.id, 'id');
  const hard = new URL(req.url).searchParams.get('hard');
  const isHard = hard === '1' || hard === 'true';
  const actor = await requireAdmin(isHard ? '删除账号' : '停用账号');
  return ok(isHard ? await deleteUser(id, actor) : await deactivateUser(id, actor));
});
