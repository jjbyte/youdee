/**
 * 会话（JWT + httpOnly Cookie）。
 *
 * 设计取舍：**不做 access/refresh 双令牌**。
 * 契约里没有 /auth/refresh（openapi 53 个 path 里没有），而 15 分钟过期的
 * access token 在没有刷新端点时等于每 15 分钟把人踢出去一次。这是 3-10 人的
 * 内部工具，不是面向公网的 SaaS。
 *
 * 因此：单个 Cookie，有效期 = JWT_REFRESH_TTL_DAYS（7 天），
 * 但每次请求都回库校验 `token_version` + `is_active` —— 吊销是即时的，
 * "退出所有设备" 只需 token_version + 1，无需等令牌自然过期。
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { one } from '../db';

export const SESSION_COOKIE = 'rc_session';

export interface SessionPayload {
  sub: string;
  login: string;
  name: string;
  role: 'admin' | 'member';
  tv: number;
}

export interface CurrentUser {
  id: string;
  login: string;
  name: string;
  role: 'admin' | 'member';
  isActive: boolean;
  lastLoginAt: string | null;
}

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET 未配置或过短（至少 16 字符）');
  }
  return new TextEncoder().encode(s);
}

function ttlSeconds(): number {
  const days = Number(process.env.JWT_REFRESH_TTL_DAYS || 7);
  return days * 24 * 60 * 60;
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({
    login: p.login,
    name: p.name,
    role: p.role,
    tv: p.tv,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds()}s`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      login: String(payload.login ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role === 'admin' ? 'admin' : 'member',
      tv: Number(payload.tv ?? 0),
    };
  } catch {
    return null;
  }
}

/** 写 Cookie。Secure 只在生产开 —— 本地 http://localhost 带 Secure 会被浏览器丢弃 */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttlSeconds(),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * 当前登录用户。**每次都回库**，不信 JWT 里的 claims ——
 * 令牌里的 role 可能是"昨天的 admin"。停用与降权必须立刻生效。
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await readSessionToken(token);
  if (!payload) return null;

  const row = await one<{
    id: string;
    login: string;
    name: string;
    role: string;
    is_active: boolean;
    token_version: number;
    last_login_at: Date | null;
  }>(
    'SELECT id, login, name, role, is_active, token_version, last_login_at FROM users WHERE id = $1',
    [payload.sub],
  );
  if (!row) return null;
  if (!row.is_active) return null;
  if (row.token_version !== payload.tv) return null; // 已被"退出所有设备"吊销

  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'member',
    isActive: row.is_active,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  };
}
