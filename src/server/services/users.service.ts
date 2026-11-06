/**
 * 账号管理（仅 admin）。
 *
 * 两种"删"并存，别混：
 *   · `deactivateUser`（停用）= 登不进来，历史单据的署名照旧 —— 默认动作
 *   · `deleteUser`（真删）= 从库里消失，报价单的 created_by 变 NULL
 *     第二条只在**名下没有任何报价单**时才允许，否则台账会永久丢掉"谁出的这单"。
 *     真删之后登录名可以重新建号，这是它唯一比停用强的地方（建错账号时有用）。
 */
import { one, q } from '../db';
import { AppError } from '../http';
import { hashPassword } from '../auth/password';
import { PHONE_MIN_DIGITS, cleanPhone, phoneDigitCount } from '@/domain/phone';
import type { CurrentUser } from '../auth/session';

interface UserRow {
  id: string;
  login: string;
  name: string;
  role: string;
  /** 报价单抬头给客户看的电话 */
  phone: string | null;
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
    phone: r.phone,
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
    `SELECT id, login, name, role, phone, is_active, last_login_at, created_at FROM users ${where}
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

/**
 * 电话：null / '' 都表示"没填"，不报错——这个字段是给客户看的便利信息，
 * 不是账号能不能用的前置条件。填了就要求像个号码。
 */
function normalizePhoneOrNull(raw: string | null | undefined): string | null {
  const s = cleanPhone(raw);
  if (!s) return null;
  if (phoneDigitCount(s) < PHONE_MIN_DIGITS) {
    throw new AppError(40001, '电话至少要有 7 位数字（座机写区号，手机写 11 位）。', 400, { field: 'phone' });
  }
  if (s.length > 30) {
    throw new AppError(40001, '电话最多 30 个字符。', 400, { field: 'phone' });
  }
  return s;
}

export async function createUser(input: {
  login: string;
  name: string;
  password: string;
  role: string;
  phone?: string | null;
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
  const phone = normalizePhoneOrNull(input.phone);
  const hash = await hashPassword(input.password);
  const rows = await q<UserRow>(
    `INSERT INTO users (login, password_hash, name, role, phone, is_active, token_version)
     VALUES ($1,$2,$3,$4,$5,true,0)
     RETURNING id, login, name, role, phone, is_active, last_login_at, created_at`,
    [input.login, hash, input.name, input.role, phone],
  );
  return dto(rows[0]!);
}

export async function patchUser(
  id: string,
  input: { name?: string; role?: string; is_active?: boolean; password?: string; phone?: string | null },
  actor: CurrentUser,
) {
  const current = await one<UserRow>(
    'SELECT id, login, name, role, phone, is_active, last_login_at, created_at FROM users WHERE id = $1',
    [id],
  );
  if (!current) throw new AppError(40401, '这个账号不存在。', 404);

  if (input.role && input.role !== 'admin' && input.role !== 'member') {
    throw new AppError(40001, 'role 只能是 admin 或 member。', 400, { field: 'role' });
  }
  // 把自己降权/停用会让系统失去最后一个管理员入口，这类"把自己锁在门外"的操作直接拒
  //
  // 判的是「**正在生效**的管理员会不会少一个」：目标账号本来就已停用时，
  // 把它降成成员不会让任何启用的管理员消失，不该被拦。
  // 0.1.11 加了权限编辑界面后这个错判立刻显形：停用过的管理员改不回成员，
  // 提示还是「系统至少要保留一个启用状态的管理员」——和用户在做的事毫无关系。
  const losingEnabledAdmin =
    current.role === 'admin' && current.is_active && (input.role === 'member' || input.is_active === false);
  if (losingEnabledAdmin && current.id === actor.id) {
    throw new AppError(40904, '不能把自己降权或停用，请让另一个管理员来操作。', 409);
  }
  if (losingEnabledAdmin) {
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
            phone = CASE WHEN $6::boolean THEN $7::text ELSE phone END,
            password_hash = COALESCE($5, password_hash),
            token_version = token_version + CASE WHEN $5::text IS NULL THEN 0 ELSE 1 END
      WHERE id=$1
      RETURNING id, login, name, role, phone, is_active, last_login_at, created_at`,
    [
      id,
      input.name ?? current.name,
      input.role ?? current.role,
      input.is_active ?? current.is_active,
      hash,
      // 三态：不传 = 不动这一列；传 null / '' = 清空；有值 = 校验后写入
      input.phone !== undefined,
      input.phone === undefined ? null : normalizePhoneOrNull(input.phone),
    ],
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
  // 同上：只有「停掉一个正在生效的管理员」才可能让系统失去管理员入口
  if (current.role === 'admin' && current.is_active) {
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

export interface DeleteUserResult {
  deleted: true;
  /** 被清空署名的价格记录条数：删完之后要告诉管理员"这些记录还在，只是没人署名了" */
  prices_unsigned: number;
}

/**
 * 真删一个普通成员。
 *
 * 三条硬约束（都在服务端拦，不是只在界面上不显示按钮）：
 *   1. 不能删自己 —— 删完就没人能操作了，和"把自己锁在门外"是同一类事故；
 *   2. 只能删成员 —— 管理员先降权或停用，删管理员等于绕过"至少留一个管理员"的约束；
 *   3. 名下不能有报价单 —— quotes.created_by 是 ON DELETE SET NULL，
 *      真删会让那些单的「报价人」永久空白，而台账最需要的就是这条信息。
 *      有单的账号请用停用：登不进来，署名还在。
 *      （只数未删除的单：已经软删的单在列表里查不到，不该继续占着登录名。）
 *
 * 价格记录（prices.created_by / price_change_logs.changed_by）同样是 SET NULL，
 * 但它们不构成"这张单是谁出的"这种不可替代的证据，所以只计数、不拦截、不静默。
 */
export async function deleteUser(id: string, actor: CurrentUser): Promise<DeleteUserResult> {
  const current = await one<{ id: string; login: string; name: string; role: string }>(
    'SELECT id, login, name, role FROM users WHERE id = $1',
    [id],
  );
  if (!current) throw new AppError(40401, '这个账号不存在。', 404);
  if (current.id === actor.id) {
    throw new AppError(40904, '不能删除自己。要退出这个账号，请让另一个管理员操作。', 409);
  }
  if (current.role === 'admin') {
    throw new AppError(
      40904,
      '管理员账号不能删除。先把它降成成员（或停用），确认没问题后再删。',
      409,
      { detail: { role: current.role } },
    );
  }

  /**
   * 只数**还查得到**的单（deleted_at IS NULL）：软删掉的单在列表里已经不出现，
   * 为它保留一个登录名没有意义；但留在台账里那张单必须保住署名。
   */
  const quotes = await one<{ total: string; issued: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'issued')::text AS issued
       FROM quotes WHERE created_by = $1 AND deleted_at IS NULL`,
    [id],
  );
  const total = Number(quotes?.total ?? 0);
  if (total > 0) {
    const issued = Number(quotes?.issued ?? 0);
    throw new AppError(
      40906,
      `「${current.name}」名下还有 ${total} 张报价单${issued > 0 ? `（其中 ${issued} 张已发出）` : ''}。`
        + '删掉账号后这些单的「报价人」会永久变成空白，对账时查不回来。'
        + '请改用「停用」：他立刻登不进来，但单据上还是他的名字。',
      409,
      { detail: { quote_count: total, issued_count: issued } },
    );
  }

  const prices = await one<{ n: string }>(
    `SELECT ((SELECT count(*) FROM prices WHERE created_by = $1)
           + (SELECT count(*) FROM price_change_logs WHERE changed_by = $1))::text AS n`,
    [id],
  );

  // sessions.user_id 是 ON DELETE CASCADE，登录会话随账号一起消失
  await q('DELETE FROM users WHERE id = $1', [id]);
  return { deleted: true, prices_unsigned: Number(prices?.n ?? 0) };
}
