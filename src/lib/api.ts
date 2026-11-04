/**
 * API 客户端（唯一出口）。
 *
 * 约定：
 *   - 信封 { code, data, message }，code !== 0 抛 ApiError（保留 code / message / data）
 *   - 页面显示 message 原文，**不改写服务端的中文提示**
 *   - 认证走 httpOnly Cookie rc_session，前端不读不写
 *   - 服务端若返回 snake_case，这里统一转 camelCase（deepCamel），页面只认一套键名
 */
import type {
  Category,
  CompareResult,
  CompanyProfile,
  CurrentUser,
  DashboardSummary,
  ItemDetail,
  ItemListItem,
  Page,
  Price,
  PriceLookupResult,
  PriceTrend,
  QuoteDetail,
  QuoteListItem,
  QuoteSettings,
  QuoteTotals,
  RiskCheckResult,
  Supplier,
  UserRecord,
} from './types';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly data: unknown;
  readonly field?: string;

  constructor(code: number, message: string, status: number, data: unknown, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
    this.field = field;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** 401 = 会话过期；调用方统一跳登录 */
export function isUnauthorized(e: unknown): boolean {
  return isApiError(e) && (e.status === 401 || e.code === 40101 || e.code === 40102);
}

function camelKey(k: string): string {
  if (!k.includes('_')) return k;
  return k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** 递归把对象的 snake_case 键转成 camelCase；只动键名，不动值 */
function deepCamel<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => deepCamel(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[camelKey(k)] = deepCamel(val);
    }
    return out as T;
  }
  return v as T;
}

interface Envelope {
  code?: number;
  data?: unknown;
  message?: string;
  field?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(-1, '网络断了，这次没连上。检查一下网络再试。', 0, null);
  }

  // 二进制（导出 Excel）
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError(-1, `服务器返回了 ${res.status}，这次没成。`, res.status, null);
    }
    return (await res.blob()) as unknown as T;
  }

  let payload: Envelope = {};
  try {
    payload = (await res.json()) as Envelope;
  } catch {
    throw new ApiError(-1, `服务器返回了 ${res.status}，内容读不出来。`, res.status, null);
  }

  const code = typeof payload.code === 'number' ? payload.code : res.ok ? 0 : res.status;
  if (!res.ok || code !== 0) {
    const message =
      payload.message && String(payload.message).trim()
        ? String(payload.message)
        : `这次没成（${code}），稍后重试。`;
    throw new ApiError(code, message, res.status, deepCamel(payload.data), payload.field);
  }
  return deepCamel<T>(payload.data);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // ── 认证 ──
  login: (login: string, password: string) =>
    request<CurrentUser>('/auth/login', { method: 'POST', body: { login, password } }),
  logout: () => request<null>('/auth/logout', { method: 'POST' }),
  me: () => request<CurrentUser>('/auth/me'),

  // ── 分类 / 供应商 / 单位 ──
  categories: (domain?: 'material' | 'personnel') =>
    request<Category[] | { material?: Category[]; personnel?: Category[] }>(
      `/categories${qs({ domain })}`,
    ),
  suppliers: (params: { q?: string; type?: string; isActive?: boolean; page?: number; limit?: number } = {}) =>
    request<Page<Supplier>>(`/suppliers${qs(params)}`),
  createSupplier: (body: Record<string, unknown>) =>
    request<Supplier>('/suppliers', { method: 'POST', body }),

  // ── 主体 ──
  items: (params: {
    itemType?: 'material' | 'personnel';
    q?: string;
    categoryId?: string;
    supplierId?: string;
    page?: number;
    limit?: number;
  }) => request<Page<ItemListItem>>(`/items${qs(params)}`),
  item: (id: string) => request<ItemDetail>(`/items/${id}`),
  searchLite: (q: string, itemType?: 'material' | 'personnel', limit = 20) =>
    request<ItemListItem[]>(`/items/search-lite${qs({ q, itemType, limit })}`),

  // ── 比价 / 趋势 / 取价 ──
  compare: (
    itemId: string,
    params: { qty: string | number; taxBasis?: 'inclusive' | 'exclusive'; pricingNature?: string; onDate?: string },
  ) => request<CompareResult>(`/items/${itemId}/compare${qs(params)}`),
  priceTrend: (itemId: string, params: { from: string; to: string; pricingNature?: string; tierMinQty?: number }) =>
    request<PriceTrend>(`/items/${itemId}/price-trend${qs(params)}`),
  priceLookup: (params: {
    itemId: string;
    qty: string | number;
    pricingNature: string;
    taxBasis: 'inclusive' | 'exclusive';
    onDate?: string;
    supplierId?: string;
  }) => request<PriceLookupResult>(`/price-lookup${qs(params)}`),

  // ── 价格条目 ──
  prices: (params: { itemId?: string; supplierId?: string; status?: string; page?: number; limit?: number } = {}) =>
    request<Page<Price>>(`/prices${qs(params)}`),
  createPrice: (body: Record<string, unknown>) => request<Price>('/prices', { method: 'POST', body }),
  archivePrice: (id: string, reason?: string) =>
    request<Price>(`/prices/${id}/archive`, { method: 'POST', body: { reason } }),

  // ── 报价单 ──
  quotes: (params: { q?: string; status?: string; projectType?: string; page?: number; limit?: number } = {}) =>
    request<Page<QuoteListItem>>(`/quotes${qs(params)}`),
  quote: (id: string) => request<QuoteDetail>(`/quotes/${id}`),
  createQuote: (body: Record<string, unknown>) =>
    request<QuoteDetail>('/quotes', { method: 'POST', body }),
  updateQuote: (id: string, body: Record<string, unknown>) =>
    request<QuoteDetail>(`/quotes/${id}`, { method: 'PATCH', body }),
  deleteQuote: (id: string) => request<null>(`/quotes/${id}`, { method: 'DELETE' }),
  addQuoteItem: (id: string, body: Record<string, unknown>) =>
    request<{ item: Record<string, unknown>; quoteTotals: QuoteTotals }>(`/quotes/${id}/items`, {
      method: 'POST',
      body,
    }),
  addQuoteItemsBulk: (id: string, items: Array<Record<string, unknown>>) =>
    request<{ items: Array<Record<string, unknown>>; quoteTotals: QuoteTotals }>(
      `/quotes/${id}/items/bulk`,
      { method: 'POST', body: { items } },
    ),
  updateQuoteItem: (id: string, itemId: string, body: Record<string, unknown>) =>
    request<{ item: Record<string, unknown>; quoteTotals: QuoteTotals }>(
      `/quotes/${id}/items/${itemId}`,
      { method: 'PATCH', body },
    ),
  deleteQuoteItem: (id: string, itemId: string) =>
    request<{ quoteTotals: QuoteTotals }>(`/quotes/${id}/items/${itemId}`, { method: 'DELETE' }),
  applyTargetMargin: (id: string, itemIds?: string[]) =>
    request<{ updated: Array<{ itemId: string; oldSaleUnitPrice: string; newSaleUnitPrice: string }>; quoteTotals: QuoteTotals }>(
      `/quotes/${id}/apply-target-margin`,
      { method: 'POST', body: itemIds ? { itemIds } : {} },
    ),
  riskCheck: (id: string) => request<RiskCheckResult>(`/quotes/${id}/risk-check`, { method: 'POST' }),
  issueQuote: (id: string) => request<QuoteDetail>(`/quotes/${id}/issue`, { method: 'POST' }),
  voidQuote: (id: string, reason?: string) =>
    request<QuoteDetail>(`/quotes/${id}/void`, { method: 'POST', body: { reason } }),
  newVersion: (id: string, copyItems = true) =>
    request<QuoteDetail>(`/quotes/${id}/new-version`, { method: 'POST', body: { copyItems } }),
  taxBasisPreview: (id: string, taxStatement: 'inclusive' | 'exclusive') =>
    request<{
      affectedLines: Array<{
        lineId: string;
        itemNameSnapshot: string;
        supplierNameSnapshot: string | null;
        pricingMode: 'auto' | 'manual';
        oldCost: string;
        newCost: string | null;
        oldSale: string;
        newSale: string;
        willBeMissing: boolean;
      }>;
      summary: {
        totalBefore: string;
        totalAfter: string;
        changedLines: number;
        autoPricedLines: number;
        manualPricedLines: number;
        missingAfter: number;
      };
    }>(`/quotes/${id}/tax-basis/preview`, { method: 'POST', body: { taxStatement } }),

  // ── 工作台 / 设置 / 用户 / 通知 ──
  dashboard: () => request<DashboardSummary>('/dashboard/summary'),
  quoteSettings: () => request<QuoteSettings>('/settings/quote'),
  updateQuoteSettings: (body: Partial<QuoteSettings>) =>
    request<QuoteSettings>('/settings/quote', { method: 'PATCH', body }),
  company: () => request<CompanyProfile>('/settings/company'),
  updateCompany: (body: Partial<CompanyProfile>) =>
    request<CompanyProfile>('/settings/company', { method: 'PATCH', body }),
  users: (params: { q?: string; role?: string; page?: number; limit?: number } = {}) =>
    request<Page<UserRecord>>(`/users${qs(params)}`),
  unreadCount: () => request<{ unread: number }>('/notifications/unread-count'),

  exportXlsxUrl: (id: string, view: 'customer' | 'internal' = 'customer') =>
    `${API_BASE}/quotes/${id}/export.xlsx${qs({ view })}`,
};

/** 把任意异常变成一句人能读的话（优先用服务端原文） */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return '这次没成，稍后重试。';
}
