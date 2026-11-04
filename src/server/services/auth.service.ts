/**
 * 认证服务。
 *
 * 登录限流是内存计数：3-10 人的内部工具，单进程部署，够用且零依赖。
 * 若将来多实例，改成 Redis 的 INCR + EXPIRE 即可，接口形状不变。
 */
import { one, q } from '../db';
import { AppError } from '../http';
import { hashPassword, verifyPassword } from '../auth/password';
import { clearSessionCookie, setSessionCookie, signSession, type CurrentUser } from '../auth/session';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function guardRate(key: string): void {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  cur.count += 1;
  if (cur.count > MAX_ATTEMPTS) {
    throw new AppError(42901, '登录尝试过于频繁，请一分钟后再试。', 429);
  }
}

interface UserRow {
  id: string;
  login: string;
  name: string;
  role: string;
  is_active: boolean;
  password_hash: string;
  token_version: number;
  last_login_at: Date | null;
}

function currentUserDto(r: UserRow): CurrentUser {
  return {
    id: r.id,
    login: r.login,
    name: r.name,
    role: r.role === 'admin' ? 'admin' : 'member',
    isActive: r.is_active,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
  };
}

export async function login(rawLogin: string, password: string, clientKey: string): Promise<CurrentUser> {
  guardRate(`${clientKey}:${rawLogin}`);
  const rows = await q<UserRow>(
    `SELECT id, login, name, role, is_active, password_hash, token_version, last_login_at
       FROM users WHERE login = $1`,
    [rawLogin],
  );
  const row = rows[0];
  // 账号不存在与密码错误返回同一句话：内部工具也不该把"谁存在"当作免费情报
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new AppError(40101, '账号或密码不正确。', 401);
  }
  if (!row.is_active) {
    throw new AppError(40102, '这个账号已被停用，请联系管理员。', 401);
  }

  const token = await signSession({
    sub: row.id,
    login: row.login,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'member',
    tv: row.token_version,
  });
  await setSessionCookie(token);
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
  attempts.delete(`${clientKey}:${rawLogin}`);
  return currentUserDto({ ...row, last_login_at: new Date() });
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
}

/** 退出所有设备：token_version + 1，已签发的令牌立即失效（不等 7 天自然过期） */
export async function logoutAll(userId: string): Promise<void> {
  await q('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  await clearSessionCookie();
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 10) {
    throw new AppError(40001, '新密码至少 10 位。', 400, { field: 'new_password' });
  }
  const row = await one<{ login: string; password_hash: string }>(
    'SELECT login, password_hash FROM users WHERE id = $1',
    [userId],
  );
  if (!row) throw new AppError(40101, '登录已过期，请重新登录。', 401);
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    throw new AppError(40001, '当前密码不正确。', 400, { field: 'current_password' });
  }
  if (newPassword === row.login) {
    throw new AppError(40001, '新密码不能和登录名相同。', 400, { field: 'new_password' });
  }
  const hash = await hashPassword(newPassword);
  // token_version + 1：改密码后其它设备上的会话必须失效，这是改密码的一半意义
  await q('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [userId, hash]);
  await clearSessionCookie();
}
