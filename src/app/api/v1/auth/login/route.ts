import { AppError, body, ok } from '@/server/http';
import { route } from '@/server/wrap';
import { login } from '@/server/services/auth.service';

/**
 * 登录。
 * 文档里字段叫 email，库里是 login（内部账号没有邮箱）—— 两个名字都收，
 * 只认第一个非空的，避免前端两种写法各挂一半。
 */
export const POST = route(async (req) => {
  const b = await body<{ login?: string; email?: string; password?: string }>(req);
  const identifier = (b.login ?? b.email ?? '').trim();
  if (!identifier) throw new AppError(40001, '请填写登录名。', 400, { field: 'login' });
  if (!b.password) throw new AppError(40001, '请填写密码。', 400, { field: 'password' });
  const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  return ok(await login(identifier, b.password, key));
});
