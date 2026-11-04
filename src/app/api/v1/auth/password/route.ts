import { AppError, body, ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { changePassword } from '@/server/services/auth.service';

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const b = await body<{ current_password?: string; new_password?: string }>(req);
  if (!b.current_password) throw new AppError(40001, '请填写当前密码。', 400, { field: 'current_password' });
  if (!b.new_password) throw new AppError(40001, '请填写新密码。', 400, { field: 'new_password' });
  await changePassword(user.id, b.current_password, b.new_password);
  return ok(null);
});
