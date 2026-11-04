/**
 * HTTP 信封、错误翻译、鉴权包装。
 *
 * 铁律（架构 §6.2 / §8.2）：
 *   响应体任何位置**不得出现** 23P01 / constraint / violation / prisma 字样。
 *   数据库异常必须被翻译成人能读懂、且能据此采取动作的句子。
 *
 * 信封：{ code, data, message }，code = 0 成功。
 */
import { NextResponse } from 'next/server';
import { currentUser, type CurrentUser } from './auth/session';
import { canCreatePrice, canOverridePrice, canManageCatalog, canManageUsers, canExportInternal } from '@/domain/permissions';

export interface ApiError {
  code: number;
  message: string;
  field?: string;
  detail?: Record<string, unknown>;
}

export class AppError extends Error {
  constructor(
    public code: number,
    message: string,
    public httpStatus = 400,
    public extra?: { field?: string; detail?: Record<string, unknown> },
    /**
     * 极少数错误码的契约要求把信息放在**顶层**而非 detail 里
     * （openapi ErrorEnvelope.proposed_close）。只加参数不加逻辑，
     * 其余错误码行为完全不变。
     */
    public top?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ code: 0, data, message: '' }, { status });
}

export function fail(
  code: number,
  message: string,
  httpStatus = 400,
  extra?: ApiError['detail'],
  field?: string,
  top?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      code,
      data: null,
      message,
      ...(field ? { field } : {}),
      ...(extra ? { detail: extra } : {}),
      ...(top ?? {}),
    },
    { status: httpStatus },
  );
}

/** 业务错误 → HTTP 响应。所有错误码语义见架构 §8.2，不要就地发明新码 */
const ERROR_STATUS: Record<number, number> = {
  40001: 400, 40002: 400,
  40101: 401, 40102: 401,
  40301: 403, 40302: 403,
  40401: 404,
  40901: 409, 40902: 409, 40903: 409, 40904: 409, 40905: 409, 40906: 409, 40907: 409,
  41301: 413, 41501: 415,
  42201: 422, 42202: 422, 42203: 422, 42204: 422, 42205: 422, 42206: 422, 42207: 422,
  42901: 429,
  50001: 500,
};

/**
 * PostgreSQL 原生错误 → 业务错误码。
 * 这里必须"认识"每一条约束，否则用户会看到 23P01 这种天书。
 */
export function translatePgError(e: unknown): AppError | null {
  const err = e as { code?: string; constraint?: string; detail?: string; message?: string };
  if (!err || typeof err.code !== 'string') return null;

  // 价格区间重叠（六维 EXCLUDE）
  if (err.code === '23P01') {
    return new AppError(
      40902,
      '这个供应商在相同口径下已有一段生效期重叠的价格。改价请用「新增并关闭旧价」，不要覆盖。',
      409,
      { detail: { constraint: 'prices_no_overlap' } },
    );
  }
  // check 约束
  if (err.code === '23514') {
    const map: Record<string, AppError> = {
      prices_period_valid: new AppError(40001, '生效结束日早于开始日。', 400),
      prices_base_unit_qty_positive: new AppError(42201, '折算系数必须大于 0。', 422),
      prices_price_nonneg: new AppError(40001, '单价不能为负数。', 400),
      qi_line_price_identity: new AppError(50001, '行小计与单价×数量不一致，已拒绝保存。', 500),
      qi_line_cost_identity: new AppError(50001, '行成本与成本单价×数量不一致，已拒绝保存。', 500),
      qi_line_profit_identity: new AppError(50001, '行利润与报价减成本不一致，已拒绝保存。', 500),
      quotes_margin_range: new AppError(50001, '毛利率超出可表示范围，请检查优惠金额。', 500),
      quotes_issued_at_present: new AppError(50001, '出单时间缺失，已拒绝保存。', 500),
    };
    if (err.constraint && map[err.constraint]) return map[err.constraint]!;
    return new AppError(40001, '数据未通过完整性校验，请检查填写内容。', 400, { detail: { constraint: err.constraint } });
  }
  // 唯一约束
  if (err.code === '23505') {
    const dup: Record<string, string> = {
      users_login_key: '这个登录名已被占用。',
      suppliers_name_key: '已有同名供应商。',
      quotes_quote_no_version_key: '单号重复，请重试。',
      categories_sibling_unique: '同一层下已有同名分类。',
      price_tiers_pkey: '同一价格下阶梯起始数量重复。',
    };
    const msg = (err.constraint && dup[err.constraint]) || '已存在相同记录。';
    return new AppError(40901, msg, 409, { detail: { constraint: err.constraint } });
  }
  // 外键
  if (err.code === '23503') {
    return new AppError(40904, '这条记录还被别处引用，不能删除。', 409, { detail: { constraint: err.constraint } });
  }
  // 唯一约束（排除约束已在上方）
  if (err.code === '23502') {
    return new AppError(40001, '有必填字段为空。', 400, { detail: { column: (err as { column?: string }).column } });
  }
  return null;
}

/** 统一出口：把任何异常变成合规响应 */
export function handleError(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return fail(e.code, e.message, e.httpStatus, e.extra?.detail, e.extra?.field, e.top);
  }
  const translated = translatePgError(e);
  if (translated) {
    return fail(translated.code, translated.message, translated.httpStatus, translated.extra?.detail);
  }
  // 未预期：服务端留全量日志，客户端只拿一句话
  console.error('[api] 未预期异常', e);
  return fail(50001, '服务器开小差了，请稍后重试。若反复出现，把操作步骤告诉管理员。', 500);
}

// ── 鉴权 ────────────────────────────────────────────────────

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) throw new AppError(40101, '登录已过期，请重新登录。', 401);
  return u;
}

/**
 * 权限两函数，**故意不合并成 canEditPrice**：
 *   - 新建价格：谁都能录（录价意愿是这套系统的命门，多一道门就没人录）
 *   - 改旧价：只有管理员（改错一个价，后面所有报价都错，且没人会发现）
 */
export async function requireCreatePrice(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!canCreatePrice(u.role)) throw new AppError(40301, '当前账号不能录入价格。', 403);
  return u;
}

export async function requireOverridePrice(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!canOverridePrice(u.role)) {
    throw new AppError(40301, '修改已有价格需要管理员权限。你可以新增一条新价格（旧价会自动关闭）。', 403);
  }
  return u;
}

export async function requireAdmin(what = '该操作'): Promise<CurrentUser> {
  const u = await requireUser();
  if (!canManageCatalog(u.role) || !canManageUsers(u.role)) {
    throw new AppError(40301, `${what}需要管理员权限。`, 403);
  }
  return u;
}

export async function requireExportInternal(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!canExportInternal(u.role)) throw new AppError(40302, '内部版含成本，仅管理员可导出。', 403);
  return u;
}

// ── 便捷取参 ────────────────────────────────────────────────

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function intParam(sp: URLSearchParams, key: string, def: number, min: number, max: number): number {
  const raw = sp.get(key);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function boolParam(sp: URLSearchParams, key: string): boolean | undefined {
  const raw = sp.get(key);
  if (raw === null || raw === '') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError(40001, '请求体不是合法的 JSON。', 400);
  }
}

/** 必填字符串，去空白后为空即 400（不静默转默认值） */
export function reqStr(v: unknown, field: string, maxLen = 200): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new AppError(40001, `${field}不能为空。`, 400, { field });
  if (s.length > maxLen) throw new AppError(40001, `${field}最多 ${maxLen} 个字符。`, 400, { field });
  return s;
}

export function optStr(v: unknown, maxLen = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

/** 日期只接受 yyyy-mm-dd；不做"猜格式" */
export function reqDate(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError(40001, `${field}必须是 YYYY-MM-DD 格式。`, 400, { field });
  }
  return s;
}

export function optDate(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  return reqDate(v, field);
}

export function isUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function reqUuid(v: unknown, field: string): string {
  if (!isUuid(v)) throw new AppError(40001, `${field}不是合法的 id。`, 400, { field });
  return v as string;
}

/** 数量/金额字符串：只接受十进制，拒绝科学计数法与空值 */
export function reqDecimal(v: unknown, field: string): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new AppError(40001, `${field}必须是数字（不接受科学计数法）。`, 400, { field });
  }
  return s;
}

export function optDecimal(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  return reqDecimal(v, field);
}
