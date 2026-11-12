/**
 * 合同台账 + 附件 + 关联报价单。
 *
 * 边界（照客户口径定的四条）：
 *   1. 合同是**独立台账**，不挂在报价单下面。关联是"多对多"的一张边表：
 *      一张合同底下常挂多张报价单（分阶段报价、改版、补项），单列只能记住
 *      最后一张。而没有系统报价单的合同，靠上传报价单电子版补齐——两条路并存，
 *      不是二选一，因为补签的合同往往单子早在客户微信里发过了。
 *   2. 查询按**合同编号 / 合同名称 / 公司名称（甲方）/ 客户名称（乙方）/
 *      签订日期区间 / 创建日期区间**。这六项是他们在 Excel 里每天翻的那几列。
 *   3. 附件分三个抽屉：合同电子版 / 报价单电子版 / 结算资料。混在一起的话，
 *      找结算单的人得翻完整份合同目录。
 *   4. 附件跟着合同走：合同软删了，文件还在磁盘上（跟随库行的 deleted_at），
 *      恢复合同就能重新看到 —— 删文件不删证。
 *
 * 权限：所有登录用户可读可录可改可传（合同是行政录入活，卡在管理员身上就没人录）；
 * 删除 / 恢复仅管理员（canDeleteRecord），且删除是软删，随时能恢复。
 */
import type { QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import { q, one } from '../db';
import { AppError } from '../http';
import { likePattern, paginated, type PageQuery } from '../params';
import {
  DEFAULT_CONTRACT_CATEGORY,
  isContractCategory,
  parseContractInput,
  type ContractCategory,
  type FieldIssue,
} from '@/domain/contract';
import type { CurrentUser } from '../auth/session';
import { persistLocalFile } from './upload.service';
import { discardStaged, type StagedUpload } from './upload-stream.service';
import { buildObjectKey, cosPrefix, isCosEnabled, putFileToCos } from './storage.service';
import { FILE_CATEGORY, isFileCategory, type FileCategory, type FileExt } from './file-type';

/**
 * 附件单份大小上限。
 *
 * 客户要求"去掉单个文件大小限制"，所以默认是 0 = 不限制。
 * 仍留一个环境变量口子（MAX_CONTRACT_FILE_BYTES），是因为运维可能需要
 * 在"有人往桶里灌 50GB"和"业务能传"之间临时收一下口——但默认不设。
 */
export const CONTRACT_FILE_MAX_BYTES = Number(process.env.MAX_CONTRACT_FILE_BYTES ?? 0) || 0;

export interface ContractFileDTO {
  id: string;
  kind: string;
  /** contract | quote | settlement */
  category: FileCategory;
  /** local = 本地磁盘（直接给 /uploads 链接）；cos = 云存储（走后端签名跳转） */
  storage: 'local' | 'cos';
  url: string;
  original_name: string;
  mime: string;
  /** 服务端落盘时判定的真实扩展名，前端据此决定"打开"还是"下载" */
  ext: string;
  size_bytes: number;
  sort_order: number;
  created_at: string;
}

export interface ContractQuoteDTO {
  id: string;
  quote_no: string;
  version: number;
  customer_name: string;
  event_name: string;
  status: string;
  total_price: string;
  issued_at: string | null;
  /** 报价单被软删：关联仍在，但列表里要标灰 */
  deleted: boolean;
}

export interface ContractDTO {
  id: string;
  contract_no: string | null;
  title: string;
  company_name: string;
  customer_name: string | null;
  project_name: string | null;
  /** 商业 / 租赁 / 雇佣 */
  category: ContractCategory;
  signed_on: string | null;
  amount: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** 附件总数（三个抽屉相加） */
  file_count: number;
  /** 分抽屉计数：列表里一眼看出"合同有、报价单有、结算还没传" */
  file_counts: { contract: number; quote: number; settlement: number };
  /** 关联的系统报价单张数 */
  quote_count: number;
}

export interface ContractDetailDTO extends ContractDTO {
  files: ContractFileDTO[];
  quotes: ContractQuoteDTO[];
}

interface ContractRow extends QueryResultRow {
  id: string;
  contract_no: string | null;
  title: string;
  company_name: string;
  customer_name: string | null;
  project_name: string | null;
  category: string;
  signed_on: string | null;
  amount: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  file_count: number;
  contract_file_count: number;
  quote_file_count: number;
  settlement_file_count: number;
  quote_count: number;
}

interface FileRow extends QueryResultRow {
  id: string;
  kind: string;
  category: string;
  storage: string;
  url: string;
  original_name: string | null;
  mime: string | null;
  size_bytes: string | number | null;
  sort_order: number;
  created_at: Date;
}

interface QuoteRow extends QueryResultRow {
  id: string;
  quote_no: string;
  version: number;
  customer_name: string;
  event_name: string;
  status: string;
  total_price: string;
  issued_at: Date | null;
  deleted_at: Date | null;
}

const SELECT = `
  SELECT c.id, c.contract_no, c.title, c.company_name, c.customer_name, c.project_name,
         c.category, c.signed_on, c.amount, c.note, c.created_by, u.name AS created_by_name,
         c.created_at, c.updated_at, c.deleted_at,
         (SELECT count(*) FROM contract_files f WHERE f.contract_id = c.id)::int AS file_count,
         (SELECT count(*) FROM contract_files f WHERE f.contract_id = c.id AND f.category = 'contract')::int AS contract_file_count,
         (SELECT count(*) FROM contract_files f WHERE f.contract_id = c.id AND f.category = 'quote')::int AS quote_file_count,
         (SELECT count(*) FROM contract_files f WHERE f.contract_id = c.id AND f.category = 'settlement')::int AS settlement_file_count,
         (SELECT count(*) FROM contract_quotes cq WHERE cq.contract_id = c.id)::int AS quote_count
    FROM contracts c
    LEFT JOIN users u ON u.id = c.created_by`;

function toDTO(r: ContractRow): ContractDTO {
  return {
    id: r.id,
    contract_no: r.contract_no,
    title: r.title,
    company_name: r.company_name,
    customer_name: r.customer_name,
    project_name: r.project_name,
    // 库里的值认不出时按商业合同显示：老数据 / 手工改库都不该让详情页炸掉
    category: isContractCategory(r.category) ? r.category : DEFAULT_CONTRACT_CATEGORY,
    // date 列由 db.ts 的类型解析器原样返回 yyyy-mm-dd，不做时区转换
    signed_on: r.signed_on,
    amount: r.amount,
    note: r.note,
    created_by: r.created_by,
    created_by_name: r.created_by_name,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
    file_count: Number(r.file_count ?? 0),
    file_counts: {
      contract: Number(r.contract_file_count ?? 0),
      quote: Number(r.quote_file_count ?? 0),
      settlement: Number(r.settlement_file_count ?? 0),
    },
    quote_count: Number(r.quote_count ?? 0),
  };
}

/**
 * 附件 DTO。
 *
 * `url` 是**浏览器能直接点的地址**，不是文件真实位置：
 *   - local → `/uploads/...`（静态读盘路由）
 *   - cos   → `/api/v1/contracts/<合同>/files/<附件>/raw`，那个路由再 302 到
 *             预签名地址。桶保持私有，链接不泄露凭证，5 分钟后自己失效。
 * 真实位置在 `storage_key` 里，只有服务端用。
 */
function toFileDTO(r: FileRow, contractId: string): ContractFileDTO {
  const storage: 'local' | 'cos' = r.storage === 'cos' ? 'cos' : 'local';
  const url = storage === 'cos' ? `/api/v1/contracts/${contractId}/files/${r.id}/raw` : r.url;
  const ext = (r.url.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? '';
  return {
    id: r.id,
    kind: r.kind,
    category: (isFileCategory(r.category) ? r.category : 'contract') as FileCategory,
    storage,
    url,
    original_name: r.original_name ?? '',
    mime: r.mime ?? '',
    ext,
    size_bytes: Number(r.size_bytes ?? 0),
    sort_order: r.sort_order,
    created_at: r.created_at.toISOString(),
  };
}

function toQuoteDTO(r: QuoteRow): ContractQuoteDTO {
  return {
    id: r.id,
    quote_no: r.quote_no,
    version: Number(r.version),
    customer_name: r.customer_name,
    event_name: r.event_name,
    status: r.status,
    total_price: String(r.total_price),
    issued_at: r.issued_at ? r.issued_at.toISOString() : null,
    deleted: r.deleted_at !== null,
  };
}

export interface ContractListQuery {
  /** 通配搜索：合同名称 / 编号 / 甲方 / 乙方 / 项目 */
  q: string | null;
  contractNo: string | null;
  title: string | null;
  /** 甲方 */
  company: string | null;
  /** 乙方 */
  customer: string | null;
  project: string | null;
  /**
   * 分类筛选：不传 = 全部。分类只有三个值，精确匹配即可，
   * 模糊匹配在这里没有意义，还会让人以为"租"能搜到租赁合同。
   */
  category: ContractCategory | null;
  signedFrom: string | null;
  signedTo: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  hasFile: boolean | null;
  /** 管理员勾了「已删除」才会读到软删的行 */
  includeDeleted: boolean;
  page: PageQuery;
}

/**
 * 列表顺序：签订时间倒序，没填签订日期的排在最后（NULLS LAST）。
 * 不能让没填日期的合同沉到最后就消失——它仍在列表里，只是排在末尾。
 */
export async function listContracts(query: ContractListQuery) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };

  if (!query.includeDeleted) parts.push('c.deleted_at IS NULL');
  if (query.q) {
    // 兜底搜索把五个可读字段一起模糊：人记不住自己想查的是哪一列，
    // 输了就出结果比先让他选对字段更重要
    add(
      (n) =>
        `(c.title ILIKE $${n} OR c.company_name ILIKE $${n} OR c.customer_name ILIKE $${n}
          OR c.project_name ILIKE $${n} OR c.contract_no ILIKE $${n})`,
      likePattern(query.q),
    );
  }
  if (query.contractNo) add((n) => `c.contract_no ILIKE $${n}`, likePattern(query.contractNo));
  if (query.title) add((n) => `c.title ILIKE $${n}`, likePattern(query.title));
  if (query.company) add((n) => `c.company_name ILIKE $${n}`, likePattern(query.company));
  if (query.customer) add((n) => `c.customer_name ILIKE $${n}`, likePattern(query.customer));
  if (query.project) add((n) => `c.project_name ILIKE $${n}`, likePattern(query.project));
  if (query.category) add((n) => `c.category = $${n}`, query.category);
  if (query.signedFrom) add((n) => `c.signed_on >= $${n}::date`, query.signedFrom);
  if (query.signedTo) add((n) => `c.signed_on <= $${n}::date`, query.signedTo);
  // 创建日期是 timestamptz：用半开区间 [当天 0 点, 次日 0 点) 而不是 ::date，
  // 后者按会话时区截断，前端选 11-11 会漏掉当天下午建的合同
  if (query.createdFrom) add((n) => `c.created_at >= $${n}::date`, query.createdFrom);
  if (query.createdTo) add((n) => `c.created_at < ($${n}::date + interval '1 day')`, query.createdTo);
  if (query.hasFile !== null) {
    parts.push(
      query.hasFile
        ? 'EXISTS (SELECT 1 FROM contract_files f WHERE f.contract_id = c.id)'
        : 'NOT EXISTS (SELECT 1 FROM contract_files f WHERE f.contract_id = c.id)',
    );
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const totalRows = await q<{ n: string }>(`SELECT count(*)::text AS n FROM contracts c ${where}`, params);
  const rows = await q<ContractRow>(
    `${SELECT} ${where}
      ORDER BY c.signed_on DESC NULLS LAST, c.created_at DESC
      LIMIT ${query.page.limit} OFFSET ${query.page.offset}`,
    params,
  );
  return paginated(rows.map(toDTO), Number(totalRows[0]?.n ?? 0), query.page);
}

export async function getContract(id: string, opts: { includeDeleted?: boolean } = {}): Promise<ContractDetailDTO> {
  const rows = await q<ContractRow>(
    `${SELECT} WHERE c.id = $1 ${opts.includeDeleted ? '' : 'AND c.deleted_at IS NULL'}`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);
  const files = await q<FileRow>(
    `SELECT id, kind, category, storage, url, original_name, mime, size_bytes, sort_order, created_at
       FROM contract_files WHERE contract_id = $1
      ORDER BY category, sort_order, created_at`,
    [id],
  );
  const quotes = await listLinkedQuotes(id);
  return { ...toDTO(row), files: files.map((f) => toFileDTO(f, id)), quotes };
}

/** 一张合同关联的系统报价单。软删的也返回（标灰），不然关联会"莫名其妙少一条" */
export async function listLinkedQuotes(contractId: string): Promise<ContractQuoteDTO[]> {
  const rows = await q<QuoteRow>(
    `SELECT q.id, q.quote_no, q.version, q.customer_name, q.event_name, q.status,
            q.total_price, q.issued_at, q.deleted_at
       FROM contract_quotes cq
       JOIN quotes q ON q.id = cq.quote_id
      WHERE cq.contract_id = $1
      ORDER BY q.issued_at DESC NULLS LAST, q.created_at DESC`,
    [contractId],
  );
  return rows.map(toQuoteDTO);
}

/** 校验失败 → 400，逐条问题放 detail.issues（前端按字段标红用） */
function assertValid(issues: FieldIssue[]): void {
  const first = issues[0];
  if (!first) return;
  throw new AppError(
    40001,
    issues.length === 1 ? first.message : `${first.message}（还有 ${issues.length - 1} 处要改）`,
    400,
    { field: first.field, detail: { issues } },
  );
}

export async function createContract(raw: Record<string, unknown>, actor: CurrentUser): Promise<ContractDetailDTO> {
  const { value, issues } = parseContractInput(raw, { partial: false });
  assertValid(issues);
  if (!value.title || !value.company_name) {
    // parseContractInput 已保证，这里只是让类型收窄，别让 undefined 进 SQL
    throw new AppError(40001, '合同名称与公司名称都必须填。', 400);
  }
  const rows = await q<{ id: string }>(
    `INSERT INTO contracts (contract_no, title, company_name, customer_name, project_name, category, signed_on, amount, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::numeric,$9,$10)
     RETURNING id`,
    [
      value.contract_no ?? null,
      value.title,
      value.company_name,
      value.customer_name ?? null,
      value.project_name ?? null,
      value.category ?? DEFAULT_CONTRACT_CATEGORY,
      value.signed_on ?? null,
      value.amount ?? null,
      value.note ?? null,
      actor.id,
    ],
  );
  return getContract(rows[0]!.id);
}

export async function patchContract(
  id: string,
  raw: Record<string, unknown>,
): Promise<ContractDetailDTO> {
  const existing = await one<{ id: string }>('SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!existing) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);

  const { value, issues } = parseContractInput(raw, { partial: true });
  assertValid(issues);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown, cast = '') => {
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if ('contract_no' in value) set('contract_no', value.contract_no);
  if ('title' in value) set('title', value.title);
  if ('company_name' in value) set('company_name', value.company_name);
  if ('customer_name' in value) set('customer_name', value.customer_name);
  if ('project_name' in value) set('project_name', value.project_name);
  if ('category' in value) set('category', value.category);
  if ('signed_on' in value) set('signed_on', value.signed_on, '::date');
  if ('amount' in value) set('amount', value.amount, '::numeric');
  if ('note' in value) set('note', value.note);

  if (sets.length === 0) return getContract(id);

  params.push(id);
  await q(`UPDATE contracts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  return getContract(id);
}

/**
 * 软删。合同是凭据：真删一次，如果扫描件是唯一副本（客户手里那份早丢了），
 * 就再也找不回来。所以这里只打 deleted_at，物理文件原样留着。
 */
export async function deleteContract(id: string): Promise<{ deleted: true; file_count: number }> {
  // 用 CTE 而不是在 RETURNING 里点目标表：UPDATE ... RETURNING 的子查询
  // 不能直接引用 targets，写成 contracts.id 会报 "invalid reference to FROM-clause entry"。
  const rows = await q<{ file_count: number }>(
    `WITH del AS (
       UPDATE contracts SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
     )
     SELECT (SELECT count(*) FROM contract_files f WHERE f.contract_id = del.id)::int AS file_count FROM del`,
    [id],
  );
  const r = rows[0];
  if (!r) throw new AppError(40401, '这份合同不存在，或者已经删过了。', 404);
  return { deleted: true, file_count: Number(r.file_count ?? 0) };
}

export async function restoreContract(id: string): Promise<ContractDetailDTO> {
  const rows = await q<{ id: string }>(
    'UPDATE contracts SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id',
    [id],
  );
  if (!rows[0]) throw new AppError(40401, '这份合同不存在，或者它没有被删除过。', 404);
  return getContract(id);
}

/**
 * 落一份附件：本地磁盘或腾讯云对象存储，由设置决定。
 *
 * 存哪儿记在 `contract_files.storage` 上，**不靠"当前设置"反推**：
 * 今天切到 COS，昨天那份本地附件的 storage 还是 local，读取按行分流。
 * 否则切一次配置，历史附件全体 404——那是没法向客户解释的事故。
 *
 * 临时文件在 finally 里清：无论成功、格式被拒、还是云上传失败，都不留垃圾。
 */
export async function addContractFile(
  contractId: string,
  staged: StagedUpload,
  category: FileCategory,
): Promise<ContractFileDTO> {
  try {
    const exists = await one<{ id: string }>('SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL', [
      contractId,
    ]);
    if (!exists) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);

    const rule = FILE_CATEGORY[category];
    if (!(rule.allow as readonly FileExt[]).includes(staged.type.ext)) {
      throw new AppError(
        41501,
        `这个地方只收${rule.hint}（${rule.label}），你传的是 ${staged.type.label}。`,
        415,
        { field: 'file' },
      );
    }

    const useCos = await isCosEnabled();
    let storage: 'local' | 'cos';
    let storageKey: string;
    let url: string;

    if (useCos) {
      // 对象键不带原始文件名：重名、乱码、超长路径都会到上传时才炸，那时文件已传一半
      const key = buildObjectKey(await cosPrefix(), `contracts/${contractId}`, `${randomUUID()}.${staged.type.ext}`);
      const put = await putFileToCos({
        filePath: staged.tmpPath,
        sizeBytes: staged.sizeBytes,
        key,
        contentType: staged.type.mime,
        originalName: staged.originalName,
      });
      storage = 'cos';
      storageKey = put.key;
      url = put.url;
    } else {
      const saved = await persistLocalFile(staged.tmpPath, `contracts/${contractId}`, staged.type.ext);
      storage = 'local';
      storageKey = saved.storageKey;
      url = saved.url;
    }

    const order = await one<{ n: string }>(
      'SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM contract_files WHERE contract_id = $1 AND category = $2',
      [contractId, category],
    );
    const rows = await q<FileRow>(
      `INSERT INTO contract_files (contract_id, kind, category, storage, storage_key, url, original_name, mime, size_bytes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, kind, category, storage, url, original_name, mime, size_bytes, sort_order, created_at`,
      [
        contractId,
        staged.type.kind,
        category,
        storage,
        storageKey,
        url,
        staged.originalName,
        staged.type.mime,
        staged.sizeBytes,
        Number(order?.n ?? 0),
      ],
    );
    // 传了附件是这个合同有了实质进展，列表按"最近改动"看时才不会漏掉
    await q('UPDATE contracts SET updated_at = now() WHERE id = $1', [contractId]);
    return toFileDTO(rows[0]!, contractId);
  } finally {
    await discardStaged(staged);
  }
}

/** 读一份附件的位置信息，给下载/跳转路由用 */
export async function getContractFileRef(
  contractId: string,
  fileId: string,
): Promise<{ storage: 'local' | 'cos'; storageKey: string; url: string; mime: string; originalName: string }> {
  const row = await one<{
    storage: string;
    storage_key: string;
    url: string;
    mime: string | null;
    original_name: string | null;
  }>(
    `SELECT storage, storage_key, url, mime, original_name FROM contract_files
      WHERE id = $1 AND contract_id = $2`,
    [fileId, contractId],
  );
  if (!row) throw new AppError(40401, '这份附件不存在，可能已经被删掉了。', 404);
  return {
    storage: row.storage === 'cos' ? 'cos' : 'local',
    storageKey: row.storage_key,
    url: row.url,
    mime: row.mime ?? 'application/octet-stream',
    originalName: row.original_name ?? '附件',
  };
}

/**
 * 删一份附件：先删库行。
 * 物理文件交给周清理任务回收 —— 先删文件再删库行，中途失败会留下
 * "库里有一条、点开 404"的坏记录，那比多留一个孤儿文件难查得多。
 */
export async function deleteContractFile(contractId: string, fileId: string): Promise<{ deleted: true }> {
  const rows = await q<{ id: string }>(
    'DELETE FROM contract_files WHERE id = $1 AND contract_id = $2 RETURNING id',
    [fileId, contractId],
  );
  if (!rows[0]) throw new AppError(40401, '这份附件不存在，可能已经被删掉了。', 404);
  await q('UPDATE contracts SET updated_at = now() WHERE id = $1', [contractId]);
  return { deleted: true };
}

/**
 * 关联一张系统报价单。
 *
 * 幂等：同一张单重复关联不报错（前端多手点一次不该出红条），
 * 但返回的 quote_count 会是真实的张数，调用方据此提示。
 */
export async function linkQuote(
  contractId: string,
  quoteId: string,
  actor: CurrentUser,
): Promise<{ linked: boolean; quotes: ContractQuoteDTO[] }> {
  const contract = await one<{ id: string }>('SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL', [
    contractId,
  ]);
  if (!contract) throw new AppError(40401, '这份合同不存在，可能已经被删掉了。', 404);

  const quote = await one<{ id: string; deleted_at: Date | null }>('SELECT id, deleted_at FROM quotes WHERE id = $1', [
    quoteId,
  ]);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (quote.deleted_at) throw new AppError(40901, '这张报价单已经被删除了，先把它恢复再关联。', 409);

  const inserted = await q<{ quote_id: string }>(
    `INSERT INTO contract_quotes (contract_id, quote_id, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (contract_id, quote_id) DO NOTHING
     RETURNING quote_id`,
    [contractId, quoteId, actor.id],
  );
  return { linked: inserted.length > 0, quotes: await listLinkedQuotes(contractId) };
}

export async function unlinkQuote(contractId: string, quoteId: string): Promise<{ deleted: true }> {
  const rows = await q<{ quote_id: string }>(
    'DELETE FROM contract_quotes WHERE contract_id = $1 AND quote_id = $2 RETURNING quote_id',
    [contractId, quoteId],
  );
  if (!rows[0]) throw new AppError(40401, '这条关联不存在，可能已经被取消了。', 404);
  return { deleted: true };
}
