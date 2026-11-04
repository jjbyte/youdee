/**
 * 数据访问入口（pg 连接池 + 手写 SQL）。
 *
 * 为什么不用 Prisma Client（虽然 schema.prisma 在仓库里）：
 *   1) `prices.unit_mode` 是 GENERATED ALWAYS AS ... STORED 生成列，
 *      ORM 无法表达"只读且不参与 INSERT"的列，写库会撞 "cannot insert into generated column"。
 *      而 unit_mode 恰恰是比价分组与六维唯一键的核心维度 —— 绕不开。
 *   2) `prices_no_overlap` 是 EXCLUDE USING gist，错误码 23P01 且没有约束名以外的信息。
 *      我们需要原样拿到 code / constraint / detail 才能翻译成人话（Spec §6.2）。
 *   3) 比价、价格趋势、区间命中这类查询本质是窗口函数与区间运算，SQL 比 ORM 短得多。
 *
 * Prisma 仍然负责**迁移**（prisma migrate deploy 只按顺序执行 SQL 文件，不做 diff），
 * 因此两者不冲突：DDL 归 Prisma CLI，DML 归这里。
 */
import { Pool, types as pgTypes, type PoolClient, type QueryResultRow } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __ydPool: Pool | undefined;
}

/**
 * numeric(1700) 与 date(1082) 一律以字符串取出。
 *   - numeric 转 number 会在 1234567.8901 这类金额上丢精度，而金额算错是这套系统最不可接受的错误
 *   - date 转 Date 会带上本地时区，10-01 可能变成 09-30
 */
const typeParsers = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format === 'binary') return pgTypes.getTypeParser(oid, 'binary');
    if (oid === 1700 || oid === 1082) return (v: string) => v;
    return pgTypes.getTypeParser(oid, 'text');
  },
};

export const pool: Pool =
  globalThis.__ydPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    types: typeParsers as never,
  });

if (process.env.NODE_ENV !== 'production') globalThis.__ydPool = pool;

/** 查询多行 */
export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await pool.query<T>(sql, params as never[]);
  return r.rows;
}

/** 查询单行，无结果返回 null（不抛错 —— "没有"是正常答案，不是异常） */
export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const r = await pool.query<T>(sql, params as never[]);
  return r.rows[0] ?? null;
}

/** 单值：取第一行第一列的 text/number，无结果返回 null */
export async function scalar(
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  const r = await pool.query(sql, params as never[]);
  const row = r.rows[0];
  if (!row) return null;
  const v = Object.values(row)[0];
  return v === null || v === undefined ? null : String(v);
}

/**
 * 事务。回调里必须用传入的 client，用模块级 q/one 会跑到池里另一条连接上，
 * 事务就白开了 —— 这是最容易犯又最难发现的错。
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback 失败说明连接已断，交给上层 */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** 生成 quote_no 的月份片：2026-11 → 202611 */
export function ymKey(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 今天（本地时区），yyyy-mm-dd。全项目统一从这里取"今天"，避免各处 new Date() 漂移 */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
