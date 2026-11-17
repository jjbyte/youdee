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
  Contract,
  ContractCategory,
  ContractDetail,
  ContractFile,
  ContractFileCategory,
  ContractQuote,
  ContractStatus,
  CurrentUser,
  DashboardSummary,
  InvoiceBrief,
  InvoiceDetail,
  InvoicePage,
  InvoiceUploadResult,
  ItemDetail,
  ItemListItem,
  OcrSettings,
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
  SheetPreview,
  StorageSettings,
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

/**
 * 原始字节流上传（XHR）。
 *
 * 为什么不复用 `request()`：那个走 fetch + JSON 信封，而这里 body 是文件本身。
 * 选 XHR 而不是 fetch 的唯一原因是**上传进度**：fetch 目前没有上传进度事件，
 * 几十 MB 的扫描件传上去时界面只能干等，用户会以为卡死然后强行刷新，
 * 而刷新会把正在传的文件一起掐掉。
 */
function uploadRaw<T>(
  path: string,
  file: File,
  headers: Record<string, string>,
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException('已取消', 'AbortError'));
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => reject(new ApiError(-1, '网络断了，这次没连上。检查一下网络再试。', 0, null));
    xhr.onabort = () => reject(new DOMException('已取消', 'AbortError'));
    xhr.onload = () => {
      let payload: Envelope = {};
      try {
        payload = JSON.parse(xhr.responseText) as Envelope;
      } catch {
        reject(new ApiError(-1, `服务器返回了 ${xhr.status}，这次没成。`, xhr.status, null));
        return;
      }
      const code = typeof payload.code === 'number' ? payload.code : xhr.status === 200 ? 0 : xhr.status;
      if (xhr.status < 200 || xhr.status >= 300 || code !== 0) {
        const message = payload.message && String(payload.message).trim()
          ? String(payload.message)
          : `这次没成（${code}），稍后重试。`;
        reject(new ApiError(code, message, xhr.status, deepCamel(payload.data), payload.field, deepCamel(payload.detail)));
        return;
      }
      resolve(deepCamel<T>(payload.data));
    };
    xhr.send(file);
  });
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

/**
 * 发票查询条件。列表与 ZIP **共用同一份**（ZIP 只是忽略 page/limit）——
 * 各写一份的话，"筛出来的"和"下下来的"早晚不是同一批。
 *
 * `qs()` 会把键名转成 snake_case：invoiceNo → invoice_no、hasContract → has_contract。
 */
export type InvoiceQuery = {
  /** 什么都搜（号码 / 购买方 / 销售方 / 备注）：picker 里只有一个输入框时用它 */
  q?: string;
  /** 精确 */
  invoiceNo?: string;
  invoiceCode?: string;
  /** 模糊 */
  buyer?: string;
  seller?: string;
  issuedFrom?: string;
  issuedTo?: string;
  /**
   * 三选一，互斥：
   *   normal      = 未冲红的普通票（**不含红字票**，红字票有自己的那一项）
   *   red         = 已被红字票冲掉的原票
   *   red_letter  = 票面本身是红字票（金额为负）
   */
  status?: 'normal' | 'red' | 'red_letter';
  hasFile?: boolean;
  /**
   * 是否已挂合同：1 只看挂了的，0 只看还没挂的。
   * 用 0/1 而不是布尔：spec 里这类开关统一写 `has_file=0|1`，
   * `String(false)` 传出去是 "false"，能不能被解析全看服务端那一刻的实现。
   */
  hasContract?: 0 | 1;
  contractId?: string;
  includeDeleted?: boolean;
};

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

  // ── 对象存储（合同附件） ──
  /** 只有管理员能读：里面是云账号的 SecretId */
  storageSettings: () => request<StorageSettings>('/settings/storage'),
  /** secretKey 留空/不传 = 不改；传空串 = 清空；有值 = 换新密钥 */
  updateStorageSettings: (body: {
    enabled?: boolean;
    secretId?: string;
    secretKey?: string;
    bucket?: string;
    region?: string;
    keyPrefix?: string;
    customDomain?: string | null;
  }) => request<StorageSettings>('/settings/storage', { method: 'PATCH', body }),
  /** 真传一个探针对象再删掉：只列桶测不出"能读不能写" */
  testStorage: (body: { secretId?: string; secretKey?: string; bucket?: string; region?: string } = {}) =>
    request<{ ok: boolean; bucket: string; region: string; latencyMs: number; note: string }>(
      '/settings/storage/test',
      { method: 'POST', body },
    ),
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

  // ── 合同管理 ──
  /**
   * 合同台账。主查询维度：合同编号、合同名称、公司（甲方）、客户（乙方）、
   * 签订日期区间、创建日期区间。q 是"什么都搜"的兜底入口。
   */
  /** 什么都搜的兜底入口 */
  contracts: (
    params: {
      q?: string;
      contractNo?: string;
      title?: string;
      /** 甲方 */
      company?: string;
      /** 乙方 */
      customer?: string;
      project?: string;
      /** 商业 / 租赁 / 雇佣；不传 = 全部 */
      category?: ContractCategory;
      /** 签订中 / 履约中 / 结算中 / 已结算 / 已终止；不传 = 全部 */
      status?: ContractStatus;
      signedFrom?: string;
      signedTo?: string;
      /** true = 只看「已到期 + 一个月内到期」的周期性合同（工作台那条提醒点进来用） */
      expiring?: boolean;
      createdFrom?: string;
      createdTo?: string;
      hasFile?: boolean;
      /** 只有管理员勾了才生效（服务端会按角色再判一次） */
      includeDeleted?: boolean;
      page?: number;
      limit?: number;
    } = {},
  ) => request<Page<Contract>>(`/contracts${qs(params)}`),
  contract: (id: string) => request<ContractDetail>(`/contracts/${id}`),
  createContract: (body: Record<string, unknown>) =>
    request<ContractDetail>('/contracts', { method: 'POST', body }),
  updateContract: (id: string, body: Record<string, unknown>) =>
    request<ContractDetail>(`/contracts/${id}`, { method: 'PATCH', body }),
  /** 软删：仅管理员，附件仍在磁盘上，restoreContract 即可恢复 */
  deleteContract: (id: string) =>
    request<{ deleted: boolean; fileCount: number }>(`/contracts/${id}`, { method: 'DELETE' }),
  restoreContract: (id: string) => request<ContractDetail>(`/contracts/${id}/restore`, { method: 'POST' }),
  /**
   * 上传合同附件：**原始字节流**，不是 multipart。
   *
   * 附件已经不限制单份大小，而 FormData 上传在服务端会被整份读进内存。
   * 这里用 XHR 直接发 File，浏览器从磁盘流式读，顺带能拿到上传进度；
   * fetch 没有上传进度事件，传大文件时界面会像死了一样，那比慢更让人焦虑。
   */
  uploadContractFile: (
    id: string,
    file: File,
    category: ContractFileCategory,
    opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
  ) =>
    uploadRaw<ContractFile>(`/contracts/${id}/files`, file, {
      'X-File-Category': category,
      'X-File-Name': encodeURIComponent(file.name),
    }, opts),
  deleteContractFile: (id: string, fileId: string) =>
    request<{ deleted: boolean }>(`/contracts/${id}/files/${fileId}`, { method: 'DELETE' }),
  /**
   * Excel 附件的表格预览。
   *
   * 拿的是服务端解析好的二维字符串，不是 xlsx 原文件：解析不放浏览器跑，
   * 一是避免把不受信任的 zip 容器丢给用户的机器，二是前端只收几十 KB 的 JSON。
   */
  contractFileSheet: (id: string, fileId: string) =>
    request<{ sheets: SheetPreview[] }>(`/contracts/${id}/files/${fileId}/sheet`),
  /** 关联一张系统里的报价单（幂等：重复关联不报错） */
  linkContractQuote: (id: string, quoteId: string) =>
    request<{ linked: boolean; quotes: ContractQuote[] }>(`/contracts/${id}/quotes`, {
      method: 'POST',
      body: { quote_id: quoteId },
    }),
  unlinkContractQuote: (id: string, quoteId: string) =>
    request<{ deleted: boolean }>(`/contracts/${id}/quotes/${quoteId}`, { method: 'DELETE' }),

  /**
   * 合同状态：**唯一的写入路径**。
   *
   * `PATCH /contracts/:id` 故意不收 status —— 两处都收就会出现"抽屉保存顺手把状态冲回默认"
   * 这类事故。所以界面上下拉选完立刻走这个接口，不进合同表单的保存队列。
   */
  setContractStatus: (id: string, status: ContractStatus) =>
    request<ContractDetail>(`/contracts/${id}/status`, { method: 'PATCH', body: { status } }),
  /** 合同已关联的发票 */
  contractInvoices: (id: string) => request<{ items: InvoiceBrief[] }>(`/contracts/${id}/invoices`),
  /**
   * 批量关联（幂等：同一次点两下不会出现两条一样的记录，服务端 ON CONFLICT DO NOTHING）。
   * 所以前端不需要防抖，也不需要先查后写。
   */
  linkContractInvoices: (id: string, invoiceIds: string[]) =>
    request<{ linked: number; items: InvoiceBrief[] }>(`/contracts/${id}/invoices`, {
      method: 'POST',
      body: { invoiceIds },
    }),
  unlinkContractInvoice: (id: string, invoiceId: string) =>
    request<{ deleted: boolean }>(`/contracts/${id}/invoices/${invoiceId}`, { method: 'DELETE' }),

  // ── 发票台账 ──
  /**
   * 发票列表。一次查询同时返回本页 items 与**全量** summary（服务端窗口聚合），
   * 所以不要在这里另起一次"统计"请求——两次扫表之间有人插一张票，合计就和行数对不上。
   */
  invoices: (params: InvoiceQuery & { page?: number; limit?: number } = {}) =>
    request<InvoicePage>(`/invoices${qs(params)}`),
  invoice: (id: string) => request<InvoiceDetail>(`/invoices/${id}`),
  /** 手工录入（无原件）：识别失败时的出口 */
  createInvoice: (body: Record<string, unknown>) =>
    request<InvoiceDetail>('/invoices', { method: 'POST', body }),
  /** 部分更新：不传 = 不动，null / 空串 = 清空 */
  updateInvoice: (id: string, body: Record<string, unknown>) =>
    request<InvoiceDetail>(`/invoices/${id}`, { method: 'PATCH', body }),
  /**
   * 改「账面状态」：仅 admin。**只改这一句标签，三项金额一分不动**——
   * 红字票的负数由 `isRedLetter` 决定，改状态不会翻符号（见 invoice.service 的注释）。
   */
  setInvoiceStatus: (id: string, status: 'normal' | 'red') =>
    request<InvoiceDetail>(`/invoices/${id}/status`, { method: 'PATCH', body: { status } }),
  /** 软删：仅 admin。原件一字节不动，restoreInvoice 即可恢复 */
  deleteInvoice: (id: string) =>
    request<{ deleted: boolean; fileCount: number }>(`/invoices/${id}`, { method: 'DELETE' }),
  restoreInvoice: (id: string) => request<InvoiceDetail>(`/invoices/${id}/restore`, { method: 'POST' }),
  /**
   * 上传识别：**原始字节流**，不是 multipart。
   * 与合同附件同一条链路（uploadRaw）：浏览器从磁盘流式读，顺带能拿上传进度。
   */
  uploadInvoice: (file: File, opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {}) =>
    uploadRaw<InvoiceUploadResult>('/invoices/upload', file, {
      'X-File-Name': encodeURIComponent(file.name),
    }, opts),
  /**
   * 给**已有发票**补原件：跳过识别，只把这份扫描件挂上去（后端 `/invoices/:id/files`）。
   *
   * 和 `uploadInvoice` 是两件事，别合并：那个会先跑 OCR 再决定"新建 / 合并 / 报错"，
   * 这个只往一张已经存在的票上贴文件。所以体积限制也不同——OCR 那条要 base64 进
   * 请求体（原始 ≈7.5MB 封顶），这条是纯字节流，按服务端的 20MB 走。
   */
  uploadInvoiceFile: (
    id: string,
    file: File,
    opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
  ) =>
    uploadRaw<InvoiceDetail>(`/invoices/${id}/files`, file, {
      'X-File-Name': encodeURIComponent(file.name),
    }, opts),
  /**
   * 批量下载 ZIP 的地址。**用地址导航，不要 fetch→blob**：
   * blob 会把整包读进浏览器内存，2GB 的包直接崩标签页；原生下载是浏览器流式写盘。
   *
   * 传了 `ids` 服务端就只按 id 打包、忽略其余条件（前端勾选时也只发 ids，见台账页）。
   */
  invoiceZipUrl: (params: InvoiceQuery & { ids?: string } = {}) =>
    `${API_BASE}/invoices/zip${qs(params)}`,

  // ── 发票识别设置 ──
  /** 登录即可读（上传按钮要据此置灰），但**永不回 secretKey 原文** */
  ocrSettings: () => request<OcrSettings>('/settings/ocr'),
  /** secretKey 留空/不传 = 不改；有值 = 换新密钥 */
  updateOcrSettings: (body: { enabled?: boolean; secretId?: string; secretKey?: string; region?: string }) =>
    request<OcrSettings>('/settings/ocr', { method: 'PATCH', body }),
  /** 真调一次识别（内置样例图），返回耗时——只测配置对不对，不写库 */
  testOcr: () =>
    request<{ ok: boolean; latencyMs: number; note: string }>('/settings/ocr/test', { method: 'POST' }),

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
