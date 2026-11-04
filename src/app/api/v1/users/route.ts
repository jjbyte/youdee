import { body, boolParam, ok, requireAdmin, reqStr, searchParams } from '@/server/http';
import { enumParam, pageQuery } from '@/server/params';
import { route } from '@/server/wrap';
import { createUser, listUsers } from '@/server/services/users.service';

export const GET = route(async (req) => {
  await requireAdmin('查看账号列表');
  const sp = searchParams(req);
  const page = pageQuery(sp);
  return ok(
    await listUsers({
      q: (sp.get('q') ?? '').trim() || null,
      role: enumParam(sp, 'role', ['admin', 'member'] as const),
      isActive: boolParam(sp, 'is_active') ?? null,
      limit: page.limit,
      offset: page.offset,
    }),
  );
});

export const POST = route(async (req) => {
  await requireAdmin('新建账号');
  const b = await body<{ login?: string; email?: string; name?: string; display_name?: string; password?: string; role?: string }>(req);
  const created = await createUser({
    login: reqStr(b.login ?? b.email, '登录名', 40),
    name: reqStr(b.name ?? b.display_name, '姓名', 40),
    password: reqStr(b.password, '密码', 200),
    role: reqStr(b.role, '角色', 20),
  });
  return ok(created, 201);
});
