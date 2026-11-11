/**
 * API 客户端（唯一出口）。
 *
 * 约定：
 *   - 信封 { code, data, message }，code !== 0 抛 ApiError（保留 code / message / data）
 *   - 页面显示 message 原文，**不改写服务端的中文提示**
 *   - 认证走 httpOnly Cookie rc_session，前端不读不写
 *   - **边界上只做一次换名**：响应 snake_case → camelCase（deepCamel），
 *     请求体 camelCase → snake_case（deepSnake）。页面两侧都只认 camelCase。
 *
 * 为什么请求体也要转：服务端的 body 解析器（server/quote-item-body.ts、
 * quotes/[id]/route.ts 等）**逐字读 snake_case 的键**，读不到就当「没传」。
 * 于是 `{ discountAmount: 100 }` 不报错、返回 200、优惠金额却是 0——
 * 它比 400 危险得多：用户以为存上了，下次打开发现没了，然后不再信这个系统。
 * 这类 bug 只有真点过一遍才会暴露，而前端没有 e2e，所以只能靠边界统一兜住。
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
  QuoteItem,
  QuoteListItem,
  QuoteSettings,
  QuoteTemplate,
  QuoteTotals,
  RiskCheckResult,
  Supplier,
  UserRecord,
} from './types';
import type { LayoutIssue as TemplateLayoutIssue } from '@/domain/template-layout';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly data: unknown;
  readonly field?: string;
  /** 服务端把可逐条展示的问题放在 detail 里（如模板解析的报告） */
  readonly detail?: unknown;

  constructor(code: number, message: string, status: number, data: unknown, field?: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
    this.field = field;
    this.detail = detail;
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
  detail?: unknown;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  /**
   * FormData 直接交给 fetch：它要自己生成 multipart 边界，
   * 手写 Content-Type 会把边界写错，服务端 req.formData() 直接读不出来。
   * 同时也不能走 deepSnake——文件字段不是键值对。
   */
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(deepSnake(body)),
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
    throw new ApiError(code, message, res.status, deepCamel(payload.data), payload.field, deepCamel(payload.detail));
  }
  return deepCamel<T>(payload.data);
}

function snakeKey(k: string): string {
  return k.replace(/[A-Z]/g, (c: string) => `_${c.toLowerCase()}`);
}

/** 递归把请求体的 camelCase 键转成 snake_case；只动键名，不动值（金额字符串原样过去） */
function deepSnake(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => deepSnake(x));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[snakeKey(k)] = deepSnake(val);
    }
    return out;
  }
  return v;
}

/**
 * 拼 query string。**键名转 snake_case**——接口契约（openapi）全部是 `tax_basis`
 * / `pricing_nature` / `item_id` 这类，传 camelCase 会被服务端静默忽略并退回默认值，
 * 那种 bug 不报错、只是结果是错的，最难查。
 */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(snakeKey(k), String(v));
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
  createCategory: (body: { domain: 'material' | 'personnel'; name: string; parentId?: string | null; sortOrder?: number }) =>
    request<Category>('/categories', { method: 'POST', body }),
  /** 改名是最高频的分类维护动作：客户口里的叫法一年会变好几次 */
  updateCategory: (id: string, body: { name?: string; parentId?: string | null; sortOrder?: number }) =>
    request<Category>(`/categories/${id}`, { method: 'PATCH', body }),
  suppliers: (params: {
    q?: string;
    type?: string;
    /** true = 只看在用的；省略 = 全看（含已作废） */
    isActive?: boolean;
    page?: number;
    limit?: number;
  } = {}) => request<Page<Supplier>>(`/suppliers${qs(params)}`),
  supplier: (id: string) => request<Supplier>(`/suppliers/${id}`),
  createSupplier: (body: Record<string, unknown>) =>
    request<Supplier>('/suppliers', { method: 'POST', body }),
  updateSupplier: (id: string, body: Record<string, unknown>) =>
    request<Supplier>(`/suppliers/${id}`, { method: 'PATCH', body }),
  /** 作废 / 恢复：成员也能做，可逆 */
  archiveSupplier: (id: string) =>
    request<{ id: string; name: string; isActive: boolean }>(`/suppliers/${id}/archive`, { method: 'POST' }),
  restoreSupplier: (id: string) =>
    request<{ id: string; name: string; isActive: boolean }>(`/suppliers/${id}/restore`, { method: 'POST' }),
  /** 真删除：仅管理员。有价格会被拒（40904）并说明影响面 */
  deleteSupplier: (id: string) => request<{ deleted: boolean; name: string }>(`/suppliers/${id}`, { method: 'DELETE' }),

  // ── 主体 ──
  items: (params: {
    itemType?: 'material' | 'personnel';
    q?: string;
    categoryId?: string;
    supplierId?: string;
    /** true 只看在用（默认）；false 只看已作废；'all' 全看 */
    isActive?: boolean | 'all';
    page?: number;
    limit?: number;
  }) => request<Page<ItemListItem>>(`/items${qs(params)}`),
  item: (id: string) => request<ItemDetail>(`/items/${id}`),
  createItem: (body: Record<string, unknown>) => request<{ id: string }>('/items', { method: 'POST', body }),
  updateItem: (id: string, body: Record<string, unknown>) =>
    request<ItemDetail>(`/items/${id}`, { method: 'PATCH', body }),
  /** 作废 / 恢复：成员也能做 */
  archiveItem: (id: string) =>
    request<{ id: string; name: string; isActive: boolean }>(`/items/${id}/archive`, { method: 'POST' }),
  restoreItem: (id: string) =>
    request<{ id: string; name: string; isActive: boolean }>(`/items/${id}/restore`, { method: 'POST' }),
  /** 真删除：仅管理员，连带删掉这个主体自己的价（返回里带价格条数） */
  deleteItem: (id: string) =>
    request<{ id: string; name: string; itemType: string; priceCount: number; quoteCount: number }>(
      `/items/${id}`,
      { method: 'DELETE' },
    ),
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
  /** 作废：成员也能做，可逆 */
  archivePrice: (id: string, reason?: string) =>
    request<Price>(`/prices/${id}/archive`, { method: 'POST', body: { reason } }),
  /** 撤销作废。撞上同口径在效价会 40902（消息里带撞的是哪家 / 哪段时间） */
  restorePrice: (id: string) => request<Price>(`/prices/${id}/restore`, { method: 'POST' }),
  /** 真删除：仅管理员，连带删掉变更日志与附件 */
  deletePrice: (id: string) => request<{ deleted: boolean; id: string }>(`/prices/${id}`, { method: 'DELETE' }),

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
    request<{ item: QuoteItem; quoteTotals: QuoteTotals }>(`/quotes/${id}/items`, {
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
  /**
   * 行排序。服务端要求**一次交全部行的完整顺序**（不多不少），只换一行也得把整张单的 id 列表发上去。
   * 方法名是 PATCH 不是 POST——照后端 route.ts 抄的。
   */
  reorderQuoteItems: (id: string, orderedIds: string[]) =>
    request<QuoteItem[]>(`/quotes/${id}/items/reorder`, { method: 'PATCH', body: { orderedIds } }),
  applyTargetMargin: (id: string, itemIds?: string[]) =>
    request<{ updated: Array<{ itemId: string; oldSaleUnitPrice: string; newSaleUnitPrice: string }>; quoteTotals: QuoteTotals }>(
      `/quotes/${id}/apply-target-margin`,
      { method: 'POST', body: itemIds ? { itemIds } : {} },
    ),
  riskCheck: (id: string) => request<RiskCheckResult>(`/quotes/${id}/risk-check`, { method: 'POST' }),
  issueQuote: (id: string) => request<QuoteDetail>(`/quotes/${id}/issue`, { method: 'POST' }),
  voidQuote: (id: string, reason?: string) =>
    request<QuoteDetail>(`/quotes/${id}/void`, { method: 'POST', body: { reason } }),
  /** 撤销作废：成员也能做。回到「已发出」还是「草稿」由 issued_at 决定 */
  restoreQuote: (id: string) => request<QuoteDetail>(`/quotes/${id}/restore`, { method: 'POST' }),
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
  createUser: (body: { login: string; name: string; password: string; role: string; phone?: string | null }) =>
    request<UserRecord>('/users', { method: 'POST', body }),
  /** 改姓名 / 角色 / 启用状态 / 电话 / 重设密码。角色是每次请求回库读的，改完立刻生效 */
  updateUser: (id: string, body: { name?: string; role?: string; isActive?: boolean; password?: string; phone?: string | null }) =>
    request<UserRecord>(`/users/${id}`, { method: 'PATCH', body }),
  /** 停用（不删）。报价单里的 created_by 要能一直解析出是谁出的单 */
  deactivateUser: (id: string) => request<{ isActive: boolean }>(`/users/${id}`, { method: 'DELETE' }),
  /**
   * 真删成员（不可逆）。名下还有报价单时服务端会 409 并给出张数——
   * 那时应当改用 deactivateUser，别把错误吞掉当作删成功了。
   */
  deleteUser: (id: string) =>
    request<{ deleted: boolean; pricesUnsigned: number }>(`/users/${id}?hard=1`, { method: 'DELETE' }),

  // ── 报价单模板 ──
  quoteTemplates: (params: { activeOnly?: boolean } = {}) =>
    request<{ items: QuoteTemplate[] }>(
      `/quote-templates${qs({ active_only: params.activeOnly ? 1 : undefined })}`,
    ),
  createQuoteTemplate: (body: { name: string; supplierName?: string; isDefault?: boolean; isActive?: boolean }) =>
    request<QuoteTemplate>('/quote-templates', { method: 'POST', body }),
  updateQuoteTemplate: (
    id: string,
    body: { name?: string; supplierName?: string; isDefault?: boolean; isActive?: boolean },
  ) => request<QuoteTemplate>(`/quote-templates/${id}`, { method: 'PATCH', body }),
  deleteQuoteTemplate: (id: string) =>
    request<{ deleted: boolean }>(`/quote-templates/${id}`, { method: 'DELETE' }),
  /**
   * 上传 Excel 版式。带 templateId = 给已有模板换版式；不带 = 新建。
   * 解析不通过时服务端会 422 并把逐条问题放在 data.issues 里。
   */
  importQuoteTemplate: (form: FormData) =>
    request<{ template: QuoteTemplate; issues: TemplateLayoutIssue[] }>('/quote-templates/import', {
      method: 'POST',
      body: form,
    }),
  /** 样例模板：下载后在 Excel 里改，改完传回来 */
  downloadTemplateSample: () => request<Blob>('/quote-templates/sample.xlsx'),
  /** 退回系统默认版式（不删模板，只是不再用上传的那份） */
  resetTemplateLayout: (id: string) =>
    request<QuoteTemplate>(`/quote-templates/${id}`, { method: 'PATCH', body: { resetLayout: true } }),
  /** 0.1.11 起顶栏不再有铃铛（没有列表页，点了没反应）；接口留着，接回界面时不用改后端 */
  unreadCount: () => request<{ unread: number }>('/notifications/unread-count'),

  /**
   * 导出 Excel。客户版带上预览页的四个版式参数——客户版 Excel 与打印走同一份版面模型，
   * 不传就按默认（详细 / 分组 / 含单价 / 含优惠）。
   */
  exportXlsxUrl: (
    id: string,
    view: 'customer' | 'internal' = 'customer',
    layout: { layout?: 'detailed' | 'brief'; grouped?: boolean; unitPrice?: boolean; discount?: boolean } = {},
  ) =>
    `${API_BASE}/quotes/${id}/export.xlsx${qs({
      view,
      layout: view === 'customer' ? layout.layout : undefined,
      grouped: view === 'customer' ? layout.grouped : undefined,
      unitPrice: view === 'customer' ? layout.unitPrice : undefined,
      discount: view === 'customer' ? layout.discount : undefined,
    })}`,
};

/** 把任意异常变成一句人能读的话（优先用服务端原文） */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return '这次没成，稍后重试。';
}
