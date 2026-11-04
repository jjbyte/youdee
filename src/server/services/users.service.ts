/**
 * 账号管理（仅 admin）。
 *
 * 删除一律是「停用」：报价单里 created_by 会 ON DELETE SET NULL，
 * 真删会把"这单是谁出的"永久抹掉，而那是台账最需要的一条信息。
 */
import { one, q } from '../db';
import { AppError } from '../http';
import { hashPassword } from '../auth/password';
import type { CurrentUser } from '../auth/session';

interface UserRow {
  id: string;
  login: string;
  name: string;
  role: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

function dto(r: UserRow) {
  return {
    id: r.id,
    login: r.login,
    name: r.name,
    role: r.role,
    is_active: r.is_active,
    last_login_at: r.last_login_at ? r.last_login_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

export interface UserListQuery {
  q: string | null;
  role: string | null;
  isActive: boolean | null;
  limit: number;
  offset: number;
}

export async function listUsers(query: UserListQuery) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };
  if (query.q) add((n) => `(login ILIKE $${n} OR name ILIKE $${n})`, `%${query.q!.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (query.role) add((n) => `role = $${n}`, query.role);
  if (query.isActive !== null) add((n) => `is_active = $${n}`, query.isActive);
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const total = await q<{ n: string }>(`SELECT count(*)::text AS n FROM users ${where}`, params);
  const rows = await q<UserRow>(
    `SELECT id, login, name, role, is_active, last_login_at, created_at FROM users ${where}
      ORDER BY is_active DESC, created_at LIMIT ${query.limit} OFFSET ${query.offset}`,
    params,
  );
  return {
    items: rows.map(dto),
    total: Number(total[0]?.n ?? 0),
    page: Math.floor(query.offset / query.limit) + 1,
    limit: query.limit,
    hasMore: query.offset + rows.length < Number(total[0]?.n ?? 0),
  };
}

export async function createUser(input: {
  login: string;
  name: string;
  password: string;
  role: string;
}) {
  if (input.role !== 'admin' && input.role !== 'member') {
    throw new AppError(40001, 'role 只能是 admin 或 member。', 400, { field: 'role' });
  }
  if (input.password.length < 10) {
    throw new AppError(40001, '密码至少 10 位。', 400, { field: 'password' });
  }
  if (input.password === input.login) {
    throw new AppError(40001, '密码不能和登录名相同。', 400, { field: 'password' });
  }
  const hash = await hashPassword(input.password);
  const rows = await q<UserRow>(
    `INSERT INTO users (login, password_hash, name, role, is_active, token_version)
     VALUES ($1,$2,$3,$4,true,0)
     RETURNING id, login, name, role, is_active, last_login_at, created_at`,
    [input.login, hash, input.name, input.role],
  );
  return dto(rows[0]!);
}

export async function patchUser(
  id: string,
  input: { name?: string; role?: string; is_active?: boolean; password?: string },
  actor: CurrentUser,
) {
  const current = await one<UserRow>(
    'SELECT id, login, name, role, is_active, last_login_at, created_at FROM users WHERE id = $1',
    [id],
  );
  if (!current) throw new AppError(40401, '这个账号不存在。', 404);

  if (input.role && input.role !== 'admin' && input.role !== 'member') {
    throw new AppError(40001, 'role 只能是 admin 或 member。', 400, { field: 'role' });
  }
  // 把自己降权/停用会让系统失去最后一个管理员入口，这类"把自己锁在门外"的操作直接拒
  const losingAdmin = current.role === 'admin' && (input.role === 'member' || input.is_active === false);
  if (losingAdmin && current.id === actor.id) {
    throw new AppError(40904, '不能把自己降权或停用，请让另一个管理员来操作。', 409);
  }
  if (losingAdmin) {
    const admins = await one<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE role='admin' AND is_active",
      [],
    );
    if (Number(admins?.n ?? 0) <= 1) {
      throw new AppError(40904, '系统至少要保留一个启用状态的管理员。', 409);
    }
  }

  let hash: string | null = null;
  if (input.password !== undefined) {
    if (input.password.length < 10) throw new AppError(40001, '密码至少 10 位。', 400, { field: 'password' });
    if (input.password === current.login) {
      throw new AppError(40001, '密码不能和登录名相同。', 400, { field: 'password' });
    }
    hash = await hashPassword(input.password);
  }

  const rows = await q<UserRow>(
    `UPDATE users SET name=$2, role=$3, is_active=$4,
            password_hash = COALESCE($5, password_hash),
            token_version = token_version + CASE WHEN $5::text IS NULL THEN 0 ELSE 1 END
      WHERE id=$1
      RETURNING id, login, name, role, is_active, last_login_at, created_at`,
    [id, input.name ?? current.name, input.role ?? current.role, input.is_active ?? current.is_active, hash],
  );
  return dto(rows[0]!);
}

export async function deactivateUser(id: string, actor: CurrentUser) {
  const current = await one<{ id: string; role: string; is_active: boolean }>(
    'SELECT id, role, is_active FROM users WHERE id = $1',
    [id],
  );
  if (!current) throw new AppError(40401, '这个账号不存在。', 404);
  if (current.id === actor.id) {
    throw new AppError(40904, '不能停用自己。', 409);
  }
  if (current.role === 'admin') {
    const admins = await one<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE role='admin' AND is_active",
      [],
    );
    if (Number(admins?.n ?? 0) <= 1) {
      throw new AppError(40904, '系统至少要保留一个启用状态的管理员。', 409);
    }
  }
  // token_version + 1：停用后已签发的令牌立刻失效，不用等 7 天自然过期
  await q('UPDATE users SET is_active = false, token_version = token_version + 1 WHERE id = $1', [id]);
  return { is_active: false };
}
