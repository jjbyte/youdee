/**
 * 查询参数解析（列表接口共用）。
 *
 * 为什么单独一个文件：分页/排序/白名单这三件事每个列表接口都要，
 * 各写一遍必然出现"某个接口的 limit 上限是 100、另一个是 500"。
 */
import { AppError, intParam } from './http';

export interface PageQuery {
  page: number;
  limit: number;
  offset: number;
}

export function pageQuery(sp: URLSearchParams): PageQuery {
  const page = intParam(sp, 'page', 1, 1, 100_000);
  const limit = intParam(sp, 'limit', 20, 1, 100);
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, p: PageQuery) {
  return { items, total, page: p.page, limit: p.limit, hasMore: p.offset + items.length < total };
}

/**
 * 排序白名单。未在白名单里的字段**回落到默认排序**而不是报错：
 * 排序是展示偏好，为它 400 会让人以为筛选条件有问题。
 */
export function sortClause(
  sp: URLSearchParams,
  whitelist: Record<string, string>,
  fallback: string,
): string {
  const raw = sp.get('sort');
  const col = (raw && whitelist[raw]) || fallback;
  const order = sp.get('order') === 'desc' ? 'DESC' : 'ASC';
  return `${col} ${order}`;
}

/** 简单的模糊搜索：转义 LIKE 元字符，避免用户输入 % 就全表命中 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function uuidListParam(sp: URLSearchParams, key: string): string[] | null {
  const raw = sp.get(key);
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of ids) {
    if (!re.test(id)) throw new AppError(40001, `${key} 里有不合法的 id。`, 400, { field: key });
  }
  return ids.length ? ids : null;
}

/** 查询串里的枚举参数：不合法即 400（不静默忽略，否则筛选条件会"看起来没生效"） */
export function enumParam<T extends string>(
  sp: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | null {
  const raw = sp.get(key);
  if (raw === null || raw === '') return null;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new AppError(40001, `${key} 只能是 ${allowed.join(' / ')}。`, 400, { field: key });
  }
  return raw as T;
}

export function dateParam(sp: URLSearchParams, key: string): string | null {
  const raw = sp.get(key);
  if (raw === null || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(40001, `${key} 必须是 YYYY-MM-DD 格式。`, 400, { field: key });
  }
  return raw;
}
