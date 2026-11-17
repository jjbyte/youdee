/**
 * 发票台账：列表（含窗口聚合统计）/ 详情 / 手工录入 / 编辑 / 改状态 / 软删 / 恢复。
 *
 * 四条照客户口径定的边界：
 *   1. **一次扫描出 items + summary**（`OVER ()` 窗口聚合，见 invoice-dto 的 SELECT）。
 *      写成两条 SQL 就会出现"合计和行数对不上"，而这种不一致没人能复现。
 *   2. **金额只有一种口径**：红字票记负数，统计直接 SUM。负数由 `is_red_letter`
 *      （票面性质）决定，**不由状态决定**——`setInvoiceStatus` 只改「已冲红」这句标签、
 *      一分钱都不动。0.1.38 曾让两者共用一个字段，于是"红字票入账"与"原票标已冲红"
 *      各翻一次符号，一对票在合计里抵成 −2X。
 *   3. **软删只打 deleted_at**：票是凭据（扫描件常是唯一副本），原件一字节不动，
 *      恢复后必须还在。物理回收由周任务按 storage_key 引用计数判断。
 *   4. **权限分两档**：录入 / 编辑人人可做（行政活）；改状态 / 改红字票 / 删除仅管理员。
 *      红字票会翻转金额符号，直接改"金额合计"这个对账数字，必须留一道人。
 *      具体拦截在 route 层（`requireUser` / `requireAdmin`），这里是纯数据操作。
 *
 * 不在这个文件里的三块：上传识别后的落库（invoice-upload.service）、
 * 合同↔发票边表（contract-invoice.service）、原件与 ZIP（invoice-file / invoice-zip）。
 */
import { AppError, reqUuid } from '../http';
import { one, q } from '../db';
import {
  dateParam,
  enumParam,
  likePattern,
  pageQuery,
  paginated,
  uuidListParam,
  type PageQuery,
} from '../params';
import {
  isInvoiceStatus,
  isSameInvoice,
  parseInvoiceInput,
  signAmounts,
  type InvoiceAmounts,
  type InvoiceStatus,
  type ParsedInvoice,
} from '@/domain/invoice-record';
import type { CurrentUser } from '../auth/session';
import {
  INVOICE_ORDER,
  SELECT_INVOICE,
  toInvoiceDTO,
  toInvoiceContractDTO,
  toSummaryDTO,
  type InvoiceDetailDTO,
  type InvoiceDTO,
  type InvoiceRow,
  type InvoiceSummaryDTO,
} from './invoice-dto';
import { listInvoiceFiles } from './invoice-file.service';
import { listInvoiceContracts } from './contract-invoice.service';

export interface InvoiceListQuery {
  /** 兜底搜索：号码 / 代码 / 购买方 / 销售方 / 备注 */
  q: string | null;
  /** 精确匹配（走唯一索引前导列；模糊搜索交给 q） */
  invoiceNo: string | null;
  invoiceCode: string | null;
  /** 购买方 / 销售方：模糊 */
  buyer: string | null;
  seller: string | null;
  issuedFrom: string | null;
  issuedTo: string | null;
  status: InvoiceStatus | null;
  hasFile: boolean | null;
  /** 是否已挂合同（true = 至少一份**未软删**的合同关联，false = 一份都没有） */
  hasContract: boolean | null;
  /**
   * 勾选下载的发票 id。有值时**忽略上面所有筛选**（见 `invoiceWhere`）。
   * 只有 ZIP 端点会用到，列表接口即使传了也不认（列表传 ids 没有语义）。
   */
  ids: string[] | null;
  /** 只出挂了这张合同的票（合同抽屉里用） */
  contractId: string | null;
  includeDeleted: boolean;
  page: PageQuery;
}

/**
 * 勾选下载一次最多几张。
 *
 * 与 ZIP 单包文件数上限（`ZIP_MAX_FILES = 500`）同量级但**不是同一个数**：
 * 这里限的是"勾了多少张票"，那边限的是"包里有两份文件"（多页 PDF 识别出多张票时
 * 一张票可能只对应半份文件，也可能三张票共用一份）。前端按 500 收口，这里再挡一道，
 * 免得有人手拼 URL 传 5000 个 id 让服务端去跑一个 5000 行的 IN。
 */
export const INVOICE_PICK_MAX = 500;

/**
 * 列表与 ZIP **共用同一套 WHERE**。
 *
 * 各写一套的后果：用户筛了"3 月"，下载下来的包里却有去年 12 月的票——
 * 而下载包是拿去报销的，多出来的票会被一张张手工删掉。
 *
 * @param alias 发票表的别名。ZIP 的子查询里是 `i2`，必须显式传：
 *   写死 `i` 的话，子查询会**静默地把 i 当成外层相关引用**（SQL 不报错，
 *   结果是"每行都对全表再筛一遍"），正确性靠巧合、性能是 O(n²)。
 */
export function invoiceWhere(
  query: Omit<InvoiceListQuery, 'page'>,
  alias = 'i',
): { where: string; params: unknown[] } {
  const a = alias;
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };

  // 勾选下载（`ids`）：**只按 id 取，其它筛选一律不看**。
  //
  // 为什么不是"ids AND 筛选"：用户勾了 5 行、界面上还留着"3 月"这个筛选，
  // 叠加之后可能只下来 3 张（另外 2 张是 2 月勾了没收的）。用户没法解释这件事，
  // 只会认为系统漏了他的票——而下载包是拿去报销的，漏一张就是少报一张。
  // 软删过滤仍然保留：软删的票不该出现在任何下载包里（管理员也一样）。
  if (query.ids && query.ids.length > 0) {
    add((n) => `${a}.id = ANY($${n}::uuid[])`, query.ids);
    parts.push(`${a}.deleted_at IS NULL`);
    return { where: `WHERE ${parts.join(' AND ')}`, params };
  }

  if (!query.includeDeleted) parts.push(`${a}.deleted_at IS NULL`);
  if (query.q) {
    add(
      (n) =>
        `(${a}.invoice_no ILIKE $${n} OR ${a}.invoice_code ILIKE $${n} OR ${a}.buyer_name ILIKE $${n}
          OR ${a}.seller_name ILIKE $${n} OR ${a}.remark ILIKE $${n})`,
      likePattern(query.q),
    );
  }
  // 号码 / 代码走精确匹配：这两个有索引，而 ILIKE '%x%' 用不上 btree。
  // 用户想模糊查就交给 q（它有五个字段一起模糊）
  if (query.invoiceNo) add((n) => `${a}.invoice_no = $${n}`, query.invoiceNo.toUpperCase());
  if (query.invoiceCode) add((n) => `${a}.invoice_code = $${n}`, query.invoiceCode.toUpperCase());
  if (query.buyer) add((n) => `${a}.buyer_name ILIKE $${n}`, likePattern(query.buyer));
  if (query.seller) add((n) => `${a}.seller_name ILIKE $${n}`, likePattern(query.seller));
  if (query.issuedFrom) add((n) => `${a}.issued_on >= $${n}::date`, query.issuedFrom);
  if (query.issuedTo) add((n) => `${a}.issued_on <= $${n}::date`, query.issuedTo);
  if (query.status) add((n) => `${a}.status = $${n}`, query.status);
  if (query.hasFile !== null) {
    parts.push(
      query.hasFile
        ? `EXISTS (SELECT 1 FROM invoice_files f WHERE f.invoice_id = ${a}.id)`
        : `NOT EXISTS (SELECT 1 FROM invoice_files f WHERE f.invoice_id = ${a}.id)`,
    );
  }
  // 「是否已挂合同」：口径与 `contract_count`（见 invoice-dto 的 SELECT）必须一致 ——
  // 只算**未软删**的合同。算上软删的话，"还没挂合同"里会筛出 contract_count=1 的行，
  // 用户看着"已挂 1 份"却被归进"没挂"，只会认为筛选不可信。
  if (query.hasContract !== null) {
    const exists = `EXISTS (SELECT 1 FROM contract_invoices ci
                               JOIN contracts c ON c.id = ci.contract_id AND c.deleted_at IS NULL
                              WHERE ci.invoice_id = ${a}.id)`;
    parts.push(query.hasContract ? exists : `NOT ${exists}`);
  }
  if (query.contractId) {
    add(
      (n) => `EXISTS (SELECT 1 FROM contract_invoices ci WHERE ci.invoice_id = ${a}.id AND ci.contract_id = $${n})`,
      query.contractId,
    );
  }

  return { where: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/**
 * 解析列表 / ZIP 的查询参数（两个端点**共用这一个函数**）。
 *
 * 为什么必须在服务端共用：ZIP 与列表的筛选条件只要差一个字段，
 * 用户勾了"只下 3 月的"，包里就会混进别的月份的票——而下载包是拿去报销的，
 * 多出来的票要一张张手工删掉。
 *
 * 非法枚举值（`status=xx`）返回 400 而不是静默忽略：静默忽略会让筛选看起来没生效，
 * 用户以为"没有冲红票"，其实是条件被吃掉了。
 */
export function parseInvoiceListQuery(sp: URLSearchParams, opts: { allowDeleted: boolean }): Omit<InvoiceListQuery, 'page'> & {
  page: PageQuery;
} {
  const txt = (k: string) => (sp.get(k) ?? '').trim() || null;
  /** 三态布尔：只认 1/true 与 0/false，其余（含缺失、乱写）当"没筛" */
  const flag = (k: string): boolean | null => {
    const raw = sp.get(k);
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return null;
  };

  // 勾选下载的 id 清单。超 500 直接 413：与其让服务端去跑一个几千行的 IN、
  // 再在下游按"文件数 500"报一个含义不同的错，不如在这里就说清楚是"勾太多"。
  const ids = uuidListParam(sp, 'ids');
  if (ids && ids.length > INVOICE_PICK_MAX) {
    throw new AppError(
      41301,
      `一次最多下载 ${INVOICE_PICK_MAX} 张，你勾了 ${ids.length} 张。分两批下，或改用日期筛选打包下载。`,
      413,
      { field: 'ids' },
    );
  }

  return {
    q: txt('q'),
    invoiceNo: txt('invoice_no'),
    invoiceCode: txt('invoice_code'),
    buyer: txt('buyer'),
    seller: txt('seller'),
    issuedFrom: dateParam(sp, 'issued_from'),
    issuedTo: dateParam(sp, 'issued_to'),
    status: enumParam(sp, 'status', ['normal', 'red'] as const),
    hasFile: flag('has_file'),
    hasContract: flag('has_contract'),
    ids,
    contractId: sp.get('contract_id') ? reqUuid(sp.get('contract_id'), 'contract_id') : null,
    // 「已删除」只给管理员看：成员看到一堆灰行却恢复不了，只会以为发票丢了
    includeDeleted: opts.allowDeleted && (sp.get('include_deleted') === '1' || sp.get('include_deleted') === 'true'),
    page: pageQuery(sp),
  };
}

export async function listInvoices(
  query: InvoiceListQuery,
): Promise<{
  items: InvoiceDTO[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  summary: InvoiceSummaryDTO;
}> {
  const { where, params } = invoiceWhere(query);
  const rows = await q<InvoiceRow>(
    `${SELECT_INVOICE} ${where} ${INVOICE_ORDER}
      LIMIT ${query.page.limit} OFFSET ${query.page.offset}`,
    params,
  );
  const summary = toSummaryDTO(rows);
  const page = paginated(rows.map(toInvoiceDTO), summary.count, query.page);
  return { ...page, summary };
}

export async function getInvoice(id: string, opts: { includeDeleted?: boolean } = {}): Promise<InvoiceDetailDTO> {
  const rows = await q<InvoiceRow>(
    `${SELECT_INVOICE} WHERE i.id = $1 ${opts.includeDeleted ? '' : 'AND i.deleted_at IS NULL'}`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError(40401, '这张发票不存在，可能已经被删掉了。', 404);
  const [files, contracts] = await Promise.all([listInvoiceFiles(id), listInvoiceContracts(id)]);
  return { ...toInvoiceDTO(row), files, contracts: contracts.map(toInvoiceContractDTO) };
}

/** 校验失败 → 400，逐条问题放 detail.issues（前端按字段标红用） */
function assertValid(issues: { field: string; message: string }[], notes: string[] = []): void {
  const first = issues[0];
  if (!first) return;
  throw new AppError(
    40001,
    issues.length === 1 ? first.message : `${first.message}（还有 ${issues.length - 1} 处要改）`,
    400,
    { field: first.field, detail: { issues, notes } },
  );
}

/**
 * 撞唯一键时给人看的一句话。
 *
 * 必须带**实际的发票代码与号码**：前端把这句逐字显示在输入框下面，只说"已经记过了"
 * 时用户的下一步是去列表里翻（而列表里可能根本没有那一行——见下面第二句）。
 *
 * 第二句是软删带来的真实场景：唯一键 `(invoice_code, invoice_no)` 包含已软删的行
 * （删票只打 `deleted_at`，不腾号）。用户把录错的票删掉再重录同一号码，就会撞上
 * 那张看不见的行。所以要明确给出恢复路径，否则他只会反复重试或来问"系统坏了"。
 * 「已删除」这个词必须与列表筛选上的选项完全一致（`invoice-filters.tsx` 的下拉），
 * 自造一个词等于让人对着界面找不到那个开关。
 */
function duplicateHint(invoiceCode: string, invoiceNo: string): string {
  const key = invoiceCode
    ? `发票代码 ${invoiceCode}，号码 ${invoiceNo}`
    : // 全电票没有代码：别写成「号码 X（全电票没有代码）」，那会和外面那层括号套成两层
      `号码 ${invoiceNo}，全电票没有代码`;
  return `这张票已经记过了（${key}）。要改就打开那张改；如果它已经被删除、列表里看不到，`
    + '让管理员在「已删除」里找到它恢复。';
}

/**
 * 按"同号 + 代码放宽"的口径找库里那一行（**含已软删的**）。
 *
 * 只按 `invoice_no` 取候选（走现成的 `invoices_invoice_no_idx`，候选集很小），
 * 再用领域函数 `isSameInvoice` 筛。把放宽规则写进 SQL 的 OR 里有两个问题：
 * 没法单测，而且上传链路会各写一套 —— 两边一分叉就出现"手动录拦住、上传没拦住"。
 *
 * 故意**不过滤 `deleted_at`**：唯一键本身包含软删行，这里放它过去，后面 INSERT
 * 就会撞 23505 抛一句和预查不一致的话（或者更糟：UPDATE 撞出一个怪状态）。
 * 让它命中，再靠 `duplicateHint` 把"去「已删除」里恢复"这条路径指给用户。
 *
 * `excludeId` 给 PATCH 用：改自己的号码时不能撞上自己。
 */
async function findSameInvoice(
  target: { code: string; no: string },
  opts: { excludeId?: string } = {},
): Promise<{ invoice_code: string; invoice_no: string } | null> {
  const rows = await q<{ id: string; invoice_code: string; invoice_no: string }>(
    `SELECT id, invoice_code, invoice_no
       FROM invoices
      WHERE invoice_no = $1
        AND ($3::uuid IS NULL OR id <> $3::uuid)
      ORDER BY (invoice_code = $2) DESC, created_at`,
    [target.no, target.code, opts.excludeId ?? null],
  );
  const hit = rows.find((r) => isSameInvoice({ code: r.invoice_code, no: r.invoice_no }, target));
  return hit ? { invoice_code: hit.invoice_code, invoice_no: hit.invoice_no } : null;
}

/**
 * 手工录入（无原件）。
 *
 * `status_source` 记成 `manual`：这张票的状态是人填的，之后 OCR 重传同一张票时
 * **不许覆盖**它（见 invoice-upload.service 的保护逻辑）。
 */
export async function createInvoice(raw: Record<string, unknown>, actor: CurrentUser): Promise<InvoiceDetailDTO> {
  const { value, issues, notes } = parseInvoiceInput(raw, { partial: false });
  assertValid(issues, notes);

  const v = value as Partial<ParsedInvoice>;
  if (!v.invoice_no || !v.buyer_name || !v.seller_name) {
    // parseInvoiceInput 已保证，这里只是让类型收窄，别让 undefined 进 SQL
    throw new AppError(40001, '发票号码、购买方名称、销售方名称都必须填。', 400);
  }

  const status: InvoiceStatus = v.status ?? 'normal';
  // 落到局部常量：撞唯一键的提示要带这一对号，而在 .catch 回调里
  // `v.invoice_no` 的类型收窄会丢（属性访问不算稳定引用）
  const invoiceNo = v.invoice_no;
  const invoiceCode = v.invoice_code ?? '';
  // 先按判重口径预查一遍（Spec §12-7：代码为空时对号码放宽匹配）。
  //
  // 只靠 INSERT 撞唯一键不够：唯一键是全等比较，`code='' + 号 X` 与 `code=Y + 号 X`
  // 在库里是两行，于是一张票能记两遍、合计虚增，而且不会有任何报错。
  // 23505 的 catch 仍然保留在下面 —— 并发下两人同时插入时，预查都查不到，唯一键是最后一道闸。
  const clash = await findSameInvoice({ code: invoiceCode, no: invoiceNo });
  if (clash) throw new AppError(40901, duplicateHint(clash.invoice_code, clash.invoice_no), 409);

  const rows = await q<{ id: string }>(
    `INSERT INTO invoices
       (invoice_no, invoice_code, status, status_source, is_red_letter, original_invoice_no,
        invoice_type, invoice_type_label,
        issued_on, buyer_name, buyer_tax_no, seller_name, seller_tax_no,
        amount, tax_amount, total_amount, amount_check, remark, created_by)
     VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13::numeric,$14::numeric,$15::numeric,$16,$17,$18)
     RETURNING id`,
    [
      invoiceNo,
      invoiceCode,
      status,
      v.is_red_letter === true,
      v.original_invoice_no ?? null,
      v.invoice_type ?? 'Manual',
      v.invoice_type_label ?? '手工录入',
      v.issued_on ?? null,
      v.buyer_name,
      v.buyer_tax_no ?? null,
      v.seller_name,
      v.seller_tax_no ?? null,
      v.amount ?? null,
      v.tax_amount ?? null,
      v.total_amount ?? null,
      v.amount_check ?? 'ok',
      v.remark ?? null,
      actor.id,
    ],
  ).catch((e: unknown) => {
    // 唯一键撞了要给人能照着做的一句话，而不是 23505
    if ((e as { code?: string }).code === '23505') {
      throw new AppError(40901, duplicateHint(invoiceCode, invoiceNo), 409);
    }
    throw e;
  });

  return getInvoice(rows[0]!.id);
}

/**
 * 部分更新（PATCH）。
 *
 * 三处必须显式处理，否则都是"看起来对、账上错"的那种 bug：
 *   1. `status` 只有管理员能提；成员提了 403 而不是静默忽略
 *      （静默忽略会让成员以为改成功了，然后拿着一张没冲红的票去对账）。
 *   2. 只改金额不改状态时，符号要按**库里现有的 status** 定，
 *      不能按默认的 normal 定 —— 否则编辑一张红票的备注顺手改了金额，三项会被翻成正数。
 *   3. 改过状态就置 `status_source='manual'`，之后重传同一张票不再覆盖。
 */
export async function patchInvoice(
  id: string,
  raw: Record<string, unknown>,
  actor: CurrentUser,
): Promise<InvoiceDetailDTO> {
  const existing = await one<{
    id: string;
    invoice_no: string;
    invoice_code: string;
    status: string;
    is_red_letter: boolean;
    amount: string | null;
    tax_amount: string | null;
    total_amount: string | null;
  }>(
    `SELECT id, invoice_no, invoice_code, status, is_red_letter, amount, tax_amount, total_amount
       FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) throw new AppError(40401, '这张发票不存在，可能已经被删掉了。', 404);

  const { value, issues, notes } = parseInvoiceInput(raw, {
    partial: true,
    // 只改金额、没提交「红字票」这一格时，符号要按**库里现有的票面性质**定，
    // 不能按默认的"蓝票"定 —— 否则编辑一张红字票的备注顺手改了金额，三项会被翻成正数
    redLetterFallback: existing.is_red_letter === true,
  });
  assertValid(issues, notes);

  const v = value as Partial<ParsedInvoice>;

  // 改号码/代码也要过判重（Spec §12-7）。只靠 UPDATE 撞唯一键不够：
  // 放宽口径下（代码一空一非空）UPDATE 根本撞不上，于是"另一张真票"会被静默改成
  // 和这张重合 —— 台账里两行看起来一模一样，合计虚增。这里按"改完之后"的那一对号比。
  if ('invoice_no' in v || 'invoice_code' in v) {
    const clash = await findSameInvoice(
      { code: v.invoice_code ?? existing.invoice_code, no: v.invoice_no ?? existing.invoice_no },
      { excludeId: id },
    );
    if (clash) throw new AppError(40901, duplicateHint(clash.invoice_code, clash.invoice_no), 409);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown, cast = '') => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };

  if ('invoice_no' in v) set('invoice_no', v.invoice_no);
  if ('invoice_code' in v) set('invoice_code', v.invoice_code);
  if ('issued_on' in v) set('issued_on', v.issued_on, '::date');
  if ('buyer_name' in v) set('buyer_name', v.buyer_name);
  if ('buyer_tax_no' in v) set('buyer_tax_no', v.buyer_tax_no);
  if ('seller_name' in v) set('seller_name', v.seller_name);
  if ('seller_tax_no' in v) set('seller_tax_no', v.seller_tax_no);
  if ('remark' in v) set('remark', v.remark);
  if ('original_invoice_no' in v) set('original_invoice_no', v.original_invoice_no);
  if ('amount' in v) set('amount', v.amount, '::numeric');
  if ('tax_amount' in v) set('tax_amount', v.tax_amount, '::numeric');
  if ('total_amount' in v) set('total_amount', v.total_amount, '::numeric');
  if ('amount_check' in v && v.amount_check) set('amount_check', v.amount_check);

  if ('status' in v) {
    const next = v.status;
    if (!isInvoiceStatus(next)) {
      throw new AppError(40001, '发票状态只能是「正常」或「已冲红」。', 400, { field: 'status' });
    }
    if (actor.role !== 'admin') {
      throw new AppError(40301, '只有管理员能改发票状态。', 403);
    }
    /*
     * 只改标签，**不动金额**。
     *
     * 「已冲红」表达的是"这张蓝票已经被一张红字票冲掉了"，而抵账的负数由那张红字票
     * 自己带着。这里要是再翻一次符号，同一对票就会抵两次（合计变成 −2X）。
     */
    set('status', next);
    set('status_source', 'manual');
  }

  if ('is_red_letter' in v) {
    const next = v.is_red_letter === true;
    if (actor.role !== 'admin') {
      throw new AppError(40301, '只有管理员能改「红字票」标记：它会翻转三项金额的符号，直接影响合计。', 403);
    }
    set('is_red_letter', next);
    set('status_source', 'manual');
    if (!('amount' in v) && !('tax_amount' in v) && !('total_amount' in v)) {
      // 只改票面性质：金额同步重定符号（这是 §5.5 的连锁动作，不能只改这一列）
      const signed = signAmounts(
        {
          amount: existing.amount,
          taxAmount: existing.tax_amount,
          totalAmount: existing.total_amount,
        } satisfies InvoiceAmounts,
        next,
      );
      set('amount', signed.amount, '::numeric');
      set('tax_amount', signed.taxAmount, '::numeric');
      set('total_amount', signed.totalAmount, '::numeric');
    }
  }

  if (sets.length === 0) return getInvoice(id);

  params.push(id);
  await q(`UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params).catch(
    (e: unknown) => {
      if ((e as { code?: string }).code === '23505') {
        // 提示里用"改完之后"的那一对：用户看到的就是他刚填的号码
        throw new AppError(
          40901,
          duplicateHint(v.invoice_code ?? existing.invoice_code, v.invoice_no ?? existing.invoice_no),
          409,
        );
      }
      throw e;
    },
  );
  return getInvoice(id);
}

/**
 * 改状态（仅管理员，仅 `PATCH /invoices/:id/status` 一条路径）。
 *
 * **只改标签，不动金额。** 「已冲红」= 这张蓝票被一张红字票冲掉了，
 * 而抵账的负数由那张红字票自己带着（它是 `is_red_letter`，入账时金额就是负的）。
 * 这里要是顺手翻符号，同一对票会被抵两次——0.1.38 及以前就是这样，
 * 只改状态就把合计打歪，而且只有对账时才发现。
 *
 * 要改的是"这张票面是不是红字票"（那才决定符号），走 `patchInvoice` 的 `is_red_letter`。
 */
export async function setInvoiceStatus(id: string, status: InvoiceStatus): Promise<InvoiceDetailDTO> {
  const rows = await q<{ id: string }>(
    `UPDATE invoices
        SET status = $1, status_source = 'manual', updated_at = now()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [status, id],
  );
  if (!rows[0]) throw new AppError(40401, '这张发票不存在，可能已经被删掉了。', 404);
  return getInvoice(id);
}

/**
 * 软删（仅管理员）。原件一字节不动：扫描件常是唯一副本，恢复后必须还在。
 *
 * 用 CTE 而不是在 RETURNING 里点目标表：`UPDATE ... RETURNING` 的子查询
 * 不能直接引用 targets，写成 invoices.id 会报 "invalid reference to FROM-clause entry"。
 */
export async function deleteInvoice(id: string): Promise<{ deleted: true; file_count: number }> {
  const rows = await q<{ file_count: number }>(
    `WITH del AS (
       UPDATE invoices SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
     )
     SELECT (SELECT count(*) FROM invoice_files f WHERE f.invoice_id = del.id)::int AS file_count FROM del`,
    [id],
  );
  const r = rows[0];
  if (!r) throw new AppError(40401, '这张发票不存在，或者已经删过了。', 404);
  return { deleted: true, file_count: Number(r.file_count ?? 0) };
}

export async function restoreInvoice(id: string): Promise<InvoiceDetailDTO> {
  const rows = await q<{ id: string }>(
    'UPDATE invoices SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id',
    [id],
  );
  if (!rows[0]) throw new AppError(40401, '这张发票不存在，或者它没有被删除过。', 404);
  return getInvoice(id);
}
