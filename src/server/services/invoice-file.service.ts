/**
 * 发票原件（PDF / JPG / PNG）：落盘、补挂、读取、ZIP 清单、回收条件。
 *
 * 与合同附件同一套存储约定（复用 `storage.service`，不新造抽象层）：
 *   - `local` → `UPLOAD_DIR/invoices/<uuid>.<ext>`，浏览器走 `/uploads/...`
 *   - `cos`   → 对象键在设置的前缀下，下载走 `/api/v1/invoices/:id/files/:id/raw` 的 302 预签名
 *   - 落哪儿记在行上（`invoice_files.storage`），**不靠当前设置反推**：
 *     今天切到 COS，昨天那份本地原件还是 local。否则切一次配置，历史附件全体 404。
 *
 * 为什么原件要能"一份多行"：一个多页 PDF 里识别出 3 张票，物理上只有一份文件。
 * 存三份是浪费，还会让"原件到底哪份是真的"变成一个没人能回答的问题。
 * 于是 3 行 `invoice_files` 共用同一个 `storage_key`，回收靠引用计数（见 §6.4）。
 */
import { createReadStream } from 'node:fs';
import { readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { PoolClient, QueryResultRow } from 'pg';
import { AppError } from '../http';
import { one, q } from '../db';
import { persistLocalFile, uploadRoot } from './upload.service';
import { buildObjectKey, cosPrefix, getCosObject, isCosEnabled, putFileToCos } from './storage.service';
import { discardStaged, stageUploadStream, type StagedUpload } from './upload-stream.service';
import type { FileExt } from './file-type';
import { toInvoiceFileDTO, type InvoiceFileDTO } from './invoice-dto';

/**
 * 落盘的硬上限（防有人往盘里灌 GB 级垃圾）。
 * 与 `invoice_files.size_bytes` 的 bigint 上限不是一回事：那个是"存得下"，
 * 这个是"收不收"。识别失败的图会在链路里被丢弃，所以磁盘压力本来就小。
 */
export const INVOICE_FILE_HARD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 发票收这四种：PDF / OFD / JPG / PNG。
 *
 * OFD 是数电票的国标版式（下载发票时税局给的就是它），不收等于让用户自己去转格式。
 * 通用票据识别（高级版）官方支持 OFD 的第一页，所以能直接进识别链路；
 * 卷票/销货清单那类不收是票种问题（见 `domain/invoice-ocr`），不是格式问题。
 * webp 仍然拒收：OCR 文档没承诺支持，且它不是发票的下发格式。
 */
export const INVOICE_ACCEPT_EXTS: readonly FileExt[] = ['pdf', 'ofd', 'jpg', 'png'];
export const INVOICE_ACCEPT_LABEL = 'PDF / OFD / JPG / PNG';
/** 前端上传框的 accept —— 与上面两个常量必须一致，否则选文件时就把 OFD 筛掉了 */
export const INVOICE_ACCEPT_ATTR = '.pdf,.ofd,.jpg,.jpeg,.png';

/** 落盘后的位置信息 */
export interface StoredFile {
  storage: 'local' | 'cos';
  storageKey: string;
  url: string;
  mime: string;
  /** 判定过的真实扩展名（小写、不带点） */
  ext: string;
  sizeBytes: number;
  originalName: string;
}

/** 原件位置（读路由与 ZIP 都要） */
export interface InvoiceFileRef {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  storage: 'local' | 'cos';
  storageKey: string;
  url: string;
  mime: string;
  ext: string;
  originalName: string;
  sizeBytes: number;
}

/** 校验扩展名。**只看字节判定出来的 ext**，不看客户端给的文件名 */
export function assertInvoiceExt(staged: StagedUpload): void {
  if (!(INVOICE_ACCEPT_EXTS as readonly string[]).includes(staged.type.ext)) {
    throw new AppError(
      41501,
      `发票原件只收${INVOICE_ACCEPT_LABEL}，你传的是 ${staged.type.label}。`
        + '（GIF / WEBP 请转成 JPG；Word / Excel 不是发票原件。）',
      415,
      { field: 'file' },
    );
  }
}

/**
 * 把暂存文件落到最终位置（本地磁盘或 COS）。
 *
 * 调用方负责在失败时清掉临时文件（`finally discardStaged`）；
 * 本地模式是 rename（临时文件"变成"目标文件），COS 模式是读流上传（临时文件仍在），
 * 两种情况 `discardStaged` 都安全（force 删除，文件不在也不报错）。
 *
 * 对象键不含原始文件名：重名、乱码、超长路径都会在上传时才炸，而那时文件已传一半。
 */
export async function persistInvoiceFile(staged: StagedUpload): Promise<StoredFile> {
  if (await isCosEnabled()) {
    // 子目录固定 invoices：业务根目录（默认 contracts/）是设置里的前缀，
    // 拼出来是 contracts/invoices/<uuid>.pdf —— 落在同一个业务根下，运维好找
    const key = buildObjectKey(await cosPrefix(), 'invoices', `${randomUUID()}.${staged.type.ext}`);
    const put = await putFileToCos({
      filePath: staged.tmpPath,
      sizeBytes: staged.sizeBytes,
      key,
      contentType: staged.type.mime,
      originalName: staged.originalName,
    });
    return {
      storage: 'cos',
      storageKey: put.key,
      url: put.url,
      mime: staged.type.mime,
      ext: staged.type.ext,
      sizeBytes: staged.sizeBytes,
      originalName: staged.originalName,
    };
  }

  const saved = await persistLocalFile(staged.tmpPath, 'invoices', staged.type.ext);
  return {
    storage: 'local',
    storageKey: saved.storageKey,
    url: saved.url,
    mime: staged.type.mime,
    ext: staged.type.ext,
    sizeBytes: staged.sizeBytes,
    originalName: staged.originalName,
  };
}

/**
 * 插一行 `invoice_files`。**必须在调用方的事务里**（传 client）。
 *
 * 多张票共用一份原件时，这里会被调用 N 次，`storageKey` 相同、`invoice_id` 不同。
 */
export async function insertInvoiceFileRow(
  client: PoolClient,
  invoiceId: string,
  stored: StoredFile,
): Promise<void> {
  await client.query(
    `INSERT INTO invoice_files (invoice_id, storage, storage_key, url, original_name, mime, size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      invoiceId,
      stored.storage,
      stored.storageKey,
      stored.url,
      stored.originalName.slice(0, 200),
      stored.mime.slice(0, 120),
      stored.sizeBytes,
    ],
  );
}

/**
 * 物理删除一份已经落盘的文件（回滚用）。
 *
 * **只在"这份文件确认没有被任何库行引用"时才调用**：多票共用一份原件时
 * 删掉它等于让别的那几张票点开 404。所以这里只做 best-effort，
 * 失败了也不抛（孤儿文件由周清理任务按引用计数回收）。
 */
export async function discardStoredFile(stored: StoredFile): Promise<void> {
  try {
    if (stored.storage === 'local') {
      await rm(path.join(/*turbopackIgnore: true*/ uploadRoot(), stored.storageKey), { force: true });
    }
    // COS 模式不在这里删：SDK 侧删除要额外权限，而孤儿对象由周任务回收更安全
  } catch {
    /* 回收是辅助动作，失败不该影响主流程 */
  }
}

/** 这份 `storage_key` 还有没有库行引用（§6.4 回收判据） */
export async function storageKeyStillReferenced(storageKey: string): Promise<boolean> {
  const row = await one<{ ok: number }>('SELECT 1 AS ok FROM invoice_files WHERE storage_key = $1 LIMIT 1', [storageKey]);
  return row !== null;
}

/** 一张发票挂了几个原件（上传去重时判断"要不要补挂原件"） */
export async function countInvoiceFiles(invoiceId: string): Promise<number> {
  const row = await one<{ n: string }>('SELECT count(*)::text AS n FROM invoice_files WHERE invoice_id = $1', [invoiceId]);
  return Number(row?.n ?? 0);
}

interface FileRow extends QueryResultRow {
  id: string;
  invoice_id: string;
  invoice_no: string;
  storage: string;
  storage_key: string;
  url: string;
  original_name: string;
  mime: string;
  size_bytes: string | number;
  created_at: Date;
}

function toRef(r: FileRow): InvoiceFileRef {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    storage: r.storage === 'cos' ? 'cos' : 'local',
    storageKey: r.storage_key,
    url: r.url,
    mime: r.mime,
    ext: (r.storage_key.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? '',
    originalName: r.original_name,
    // bigint 经 pg 回来是字符串；ZIP 要拿它做 yazl 的尺寸校验，必须先转成数字
    sizeBytes: Number(r.size_bytes ?? 0),
  };
}

/** 一张发票的全部原件（详情用，按创建时间） */
export async function listInvoiceFiles(invoiceId: string): Promise<InvoiceFileDTO[]> {
  const rows = await q<FileRow>(
    `SELECT f.id, f.invoice_id, i.invoice_no, f.storage, f.storage_key, f.url,
            f.original_name, f.mime, f.size_bytes, f.created_at
       FROM invoice_files f JOIN invoices i ON i.id = f.invoice_id
      WHERE f.invoice_id = $1
      ORDER BY f.created_at`,
    [invoiceId],
  );
  return rows.map((r) => toInvoiceFileDTO(r));
}

/**
 * 读一份原件的位置信息（raw 路由用）。
 *
 * 同时校验"这个附件确实属于这张发票"——不校验的话，随便换个 fileId
 * 就能从另一张发票里读出原件（越权的经典形态）。
 *
 * `includeDeleted` 只给管理员：软删的票在列表里看不见，但原件还能打开
 * （恢复后要能立刻核对）；成员连那张票都不该知道存在，所以按 404 处理。
 */
export async function getInvoiceFileRef(
  invoiceId: string,
  fileId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<InvoiceFileRef> {
  const row = await one<FileRow>(
    `SELECT f.id, f.invoice_id, i.invoice_no, f.storage, f.storage_key, f.url,
            f.original_name, f.mime, f.size_bytes, f.created_at
       FROM invoice_files f JOIN invoices i ON i.id = f.invoice_id
      WHERE f.id = $1 AND f.invoice_id = $2 ${opts.includeDeleted ? '' : 'AND i.deleted_at IS NULL'}`,
    [fileId, invoiceId],
  );
  if (!row) throw new AppError(40401, '这份原件不存在，可能已经被删掉了。', 404);
  return toRef(row);
}

/**
 * ZIP 用的清单（只取必要列，不取 `ocr_raw` 这类大字段）。
 *
 * `where` 由 `invoice.service` 的 `invoiceWhere()` 生成 —— **与列表同一套 WHERE**，
 * 这样"界面上筛出来的"和"下载下来的"必然是同一批票。各写一套的后果是
 * 用户勾了"只下 3 月的"，包里却有去年 12 月的票。
 *
 * 别名必须是 `i2`：子查询里的 `i` 会被 SQL 当成**外层的相关引用**（不报错，
 * 但会退化成"每行对全表再筛一遍"）。
 */
export async function listFilesForZip(where: string, params: unknown[]): Promise<InvoiceFileRef[]> {
  const rows = await q<FileRow>(
    `SELECT f.id, f.invoice_id, i.invoice_no, f.storage, f.storage_key, f.url,
            f.original_name, f.mime, f.size_bytes, f.created_at
       FROM invoice_files f
       JOIN invoices i ON i.id = f.invoice_id
      WHERE f.invoice_id IN (SELECT i2.id FROM invoices i2 ${where})
      ORDER BY i.issued_on DESC NULLS LAST, i.created_at DESC, f.created_at`,
    params,
  );
  return rows.map(toRef);
}

/**
 * 打开一份原件的字节流（ZIP 打包用）。
 *
 * 本地：`createReadStream` 真的是流式，峰值与文件大小无关。
 * COS：`getCosObject` 整份读进内存（≤20MB），因为现有 `storage.service` 只提供了
 *   这一条读回路径。yazl 是**逐条**取流的，所以峰值是"一份文件"而不是"整包"，
 *   与包大小无关；比起往 storage 里新增一个流式下载函数，这点内存更划算。
 */
export async function openInvoiceFileStream(ref: InvoiceFileRef): Promise<Readable> {
  if (ref.storage === 'cos') {
    const buf = await getCosObject(ref.storageKey);
    return Readable.from(buf);
  }
  const abs = path.join(/*turbopackIgnore: true*/ uploadRoot(), ref.storageKey);
  return createReadStream(abs);
}

/**
 * 读一份原件的**完整字节**（同源 content 路由用）。
 *
 * 与 `openInvoiceFileStream` 的分工：那个给 ZIP 打包用（本地真流式、峰值与文件大小无关）；
 * 这个给"在页面里看"用，需要一份**准确的 Content-Length**——库里记的 `size_bytes`
 * 是上传那一刻的值，历史数据/中断上传可能对不上，长度写错会让浏览器截断响应或一直转圈。
 * 发票原件上传硬上限 20MB，整份读进内存是可控的（合同附件那边同一条理由）。
 *
 * `includeDeleted` 只给管理员：软删的票在列表里看不见，但原件还能打开核对。
 */
export async function readInvoiceFileBytes(
  invoiceId: string,
  fileId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<{ ref: InvoiceFileRef; buf: Buffer }> {
  const ref = await getInvoiceFileRef(invoiceId, fileId, opts);

  let buf: Buffer;
  if (ref.storage === 'cos') {
    buf = await getCosObject(ref.storageKey);
  } else {
    const root = uploadRoot();
    const abs = path.resolve(/*turbopackIgnore: true*/ root, ref.storageKey);
    // 键来自库，理论上不会穿越；但"理论上"不该是唯一防线
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new AppError(40401, '这份原件的位置不合法。', 404);
    }
    try {
      buf = await readFile(/*turbopackIgnore: true*/ abs);
    } catch {
      throw new AppError(40401, '原件文件已经不在了（可能被清理任务回收过），重新传一份吧。', 404);
    }
  }
  return { ref, buf };
}

/**
 * 本地原件的状态（ZIP 首字节前预检用）。
 *
 * 不只判"文件在不在"，还要判**大小对不对**：库里记 3MB、盘上是 0 字节的记录
 * 在 yazl 里会以 "file data stream has unexpected number of bytes" 炸掉整个包。
 * 与其让 500 份里的一份毁掉整包，不如把它当"缺件"跳过并写进缺失清单——
 * 用户能照着清单去补那一份。
 *
 * COS 无法廉价预检（一次 HEAD 就是一次网络往返 × 500），所以乐观放过；
 * 真读不出来由 `zipfile.on('error')` 中止连接（浏览器报下载失败），不留残缺包。
 */
export async function localFileState(ref: InvoiceFileRef): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (ref.storage === 'cos') return { ok: true };
  try {
    const st = await stat(path.join(/*turbopackIgnore: true*/ uploadRoot(), ref.storageKey));
    if (!st.isFile()) return { ok: false, reason: '磁盘上的这个位置不是文件' };
    if (st.size === 0) return { ok: false, reason: '磁盘上的文件是 0 字节（可能没传完）' };
    if (ref.sizeBytes > 0 && st.size !== ref.sizeBytes) {
      return { ok: false, reason: `磁盘上的文件大小（${st.size} 字节）与库里记录（${ref.sizeBytes} 字节）不一致` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: '磁盘上找不到这份文件（可能被误删或还没迁移过来）' };
  }
}

/**
 * 删一份附件行：**先删库行，物理文件交给周清理任务**。
 * 反了会留下"库里有一条、点开 404"的坏记录，那比多留一个孤儿文件难查得多。
 */
export async function deleteInvoiceFile(invoiceId: string, fileId: string): Promise<{ deleted: true }> {
  const rows = await q<{ id: string }>(
    'DELETE FROM invoice_files WHERE id = $1 AND invoice_id = $2 RETURNING id',
    [fileId, invoiceId],
  );
  if (!rows[0]) throw new AppError(40401, '这份原件不存在，可能已经被删掉了。', 404);
  await q('UPDATE invoices SET updated_at = now() WHERE id = $1', [invoiceId]);
  return { deleted: true };
}

/** 上传链路收尾：无论成功失败都清掉临时文件 */
export async function cleanupStaged(staged: StagedUpload | null): Promise<void> {
  await discardStaged(staged);
}

/* ── 原始字节流入口（两个上传入口共用）──────────────────────── */

/**
 * 一个上传请求里服务端需要的四样东西。
 *
 * 故意传"取好的四个值"而不是整个 `Request`：服务层拿到 Request 就会开始读
 * `req.nextUrl` / `req.cookies`，半年后再想复用它就不只是搬一个函数了。
 */
export interface RawInvoiceUpload {
  contentType: string | null;
  /** `X-File-Name` 原值（前端会 encodeURIComponent） */
  fileName: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array> | null;
}

/** header 里只能是 ASCII，中文名前端会 encodeURIComponent，这里还原 */
export function decodeUploadName(raw: string): string {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // 编码不合法就用原样：文件名只用于展示，不该因为它让上传失败
  }
  return name.replace(/[\u0000-\u001f]/g, '').replace(/[\\/]/g, '_').slice(0, 200) || '未命名发票';
}

/**
 * 收一份发票原件的字节流到临时盘，并**在入口处**收口类型白名单。
 *
 * 两个入口共用（识别上传 `POST /invoices/upload` 与补原件 `POST /invoices/:id/files`）：
 * 各写一遍的话，将来给识别入口加上"WEBP 也收"或调大上限，补原件入口就会悄悄
 * 变成另一种规则，而两条路进来的文件最终落在同一张表里。
 *
 * 顺序不能反：
 *   ① multipart 早退（老页面会这么发，读成"没有文件"只会让人反复重试）
 *   ② 声明长度早退（省得真收完 20MB 再拒；Content-Length 可伪造也可缺失，
 *      真正的上限仍是 `stageUploadStream` 的 maxBytes）
 *   ③ 空 body 守卫（断流走到 pipeline 里会变成 500）
 *   ④ 落盘 + 魔数嗅探（只看字节，不信 Content-Type 与扩展名）
 *   ⑤ 扩展名白名单（发票只收 PDF / OFD / JPG / PNG）—— 不通过就地清临时文件
 */
export async function stageInvoiceRawUpload(req: RawInvoiceUpload): Promise<StagedUpload> {
  if ((req.contentType ?? '').includes('multipart/form-data')) {
    throw new AppError(40001, '上传方式已经换成流式上传，刷新一下页面再传一次就好。', 400, { field: 'file' });
  }

  const originalName = decodeUploadName(req.fileName ?? '');

  const declared = Number(req.contentLength ?? '');
  if (Number.isFinite(declared) && declared > INVOICE_FILE_HARD_MAX_BYTES) {
    throw new AppError(
      41301,
      `这个文件有 ${(declared / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限。发票原件不会这么大，检查一下是不是传错了文件。`,
      413,
      { field: 'file' },
    );
  }

  // 先取再判：`typeof req.body !== 'object'` 这种写法在类型收窄上不成立
  // （属性访问不是标识符，TS 也没法据此收窄），所以落到一个局部变量上再判
  const stream = req.body;
  if (!stream || typeof stream !== 'object') {
    throw new AppError(40001, '没有收到文件内容。', 400, { field: 'file' });
  }

  let staged: StagedUpload;
  try {
    staged = await stageUploadStream(stream, {
      originalName,
      maxBytes: INVOICE_FILE_HARD_MAX_BYTES,
    });
  } catch (e) {
    /*
     * 字节级类型判定失败的文案要按业务重写。
     *
     * `stageUploadStream` 是合同附件与发票共用的，它给的是"这个压缩包不是 Word 或
     * Excel 文档"这类**Office 语境**的提示 —— 对着一个传错文件的会计说这句，
     * 只会让他以为系统在找 Word。发票这边一律翻译成"收哪些格式"。
     */
    if (e instanceof AppError && e.code === 41501) {
      throw new AppError(
        41501,
        `认不出这个文件的格式。发票原件收 ${INVOICE_ACCEPT_LABEL}——图片请存成 JPG / PNG，`
          + '数电票可以直接传 OFD 或 PDF。',
        415,
        { field: 'file' },
      );
    }
    throw e;
  }

  try {
    assertInvoiceExt(staged);
  } catch (e) {
    // 判定不通过：临时文件必须立刻清掉，否则磁盘会被"传错的 GIF"慢慢填满
    await cleanupStaged(staged);
    throw e;
  }
  return staged;
}
