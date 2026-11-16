/**
 * 批量下载：把当前筛选结果打成 ZIP（流式）。
 *
 * 选型 `yazl@3.3.1` + **store 模式**（`compress:false`），理由不是"轻量"，而是：
 *   - `adm-zip` 会把整包在堆里拼装：500 份 5MB = 2.5GB 堆 → 进程直接消失，
 *     而 OOM 只表现为"进程没了"，连一行日志都没有。
 *   - 原件几乎全是 PDF/JPG/PNG（已压缩），deflate 收益 <2%，却要吃满一个 CPU 核。
 *     store 模式 CPU≈0、内存更低、首字节更快。代价是包体大 2%–5%，对"下载 30 张票"无感。
 *   - `addReadStreamLazy` 让每个条目**真正被写到时**才打开文件（不会同时开 500 个 fd，
 *     也不会同时向 COS 发 500 个请求）。
 *
 * 三条体验上的硬要求（都写在 Spec §6.2 里）：
 *   1. **首字节之前**完成：清单查询 + 数量/体积校验 + 本地文件存在性预检。
 *      这些放到开始写响应头之后就只剩"下载到一半断了"这一种表现。
 *   2. **缺文件跳过，不整包失败**：只要有一份缺就跳过它，并在包尾追加 `_缺失清单.txt`。
 *      整包失败会让 499 份好的也下不来。
 *   3. **目录全平铺**：用户下载后是在资源管理器里按名称排序找某一张票，
 *      多一层目录只是多一次点击。
 *
 * 中文文件名：yazl 的 `index.js` 里硬编码 `FILE_NAME_IS_UTF8 = 1 << 11`，
 * 所以名字永远按 UTF-8 写且置位，不需要我们手工补位（Win10 1903+ / 7-Zip / macOS 全正常）。
 */
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { AppError } from '../http';
import {
  listFilesForZip,
  localFileState,
  openInvoiceFileStream,
  type InvoiceFileRef,
} from './invoice-file.service';
import { invoiceWhere, type InvoiceListQuery } from './invoice.service';

/** 单包文件数上限。超了让人先用日期筛小一点，而不是让服务端撑到 OOM */
export const ZIP_MAX_FILES = 500;
/** 单包累计体积上限（2GB） */
export const ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** 单个文件名按 UTF-8 字节截断的上限（Windows 单段路径 255 字节，中文 3 字节/字） */
export const ZIP_NAME_MAX_BYTES = 120;

/** 缺文件清单的文件名（固定在包尾，按名称排序时能一眼找到） */
export const ZIP_MISSING_LIST_NAME = '_缺失清单.txt';

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * 按 UTF-8 **字节**截断，不切断多字节字符。
 *
 * 为什么不是 `slice(0, 120)`：那是按 UTF-16 码元截，一个中文算 1 个码元但占 3 字节，
 * 120 个字符就是 360 字节，超过 Windows 单段路径的 255 字节上限，解压会报"文件名太长"。
 * 而按字节硬切又会把一个汉字切成半个（出现方块字），所以边切边回退到边界。
 */
function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (used + len > maxBytes) break;
    out += ch;
    used += len;
  }
  return out;
}

/**
 * 文件名清洗。
 *
 * 规则（Spec §6.2）：
 *   - 去掉 Windows 非法字符 `\ / : * ? " < > |` 与控制字符
 *   - 去掉首尾空格与**结尾的点**（Windows 会静默吃掉结尾的点，导致"名字对不上"）
 *   - UTF-8 字节数截断到 ≤120 字节（保留扩展名）
 *   - 清完为空 → 回落 `${发票号}.${ext}`
 */
export function sanitizeZipEntryName(
  rawName: string,
  opts: { fallbackBase: string; ext: string; maxBytes?: number },
): string {
  const maxBytes = opts.maxBytes ?? ZIP_NAME_MAX_BYTES;
  const ext = opts.ext.replace(/^\./, '').toLowerCase();

  let name = (rawName || '')
    // 控制字符（含 \r \n \t）与 Windows 非法字符
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    // 首尾空白
    .trim()
    // 结尾的点与空格（Windows 会吃掉，且 `.` `..` 是目录占位）
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/, '');

  if (!name) name = opts.fallbackBase;

  // 没有扩展名就补上：解压后双击能不能打开，全靠这个后缀
  const hasSameExt = new RegExp(`\\.${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(name);
  if (ext && !hasSameExt) name = `${name}.${ext}`;

  // 截断时给扩展名留位置，否则 120 字节全被主名吃掉，后缀没了。
  // 扩展名按**原文大小写**保留（`.PDF` 不改成 `.pdf`）：文件名是用户的凭据线索，
  // 我们能不动就不动，只在字节超限时才切主名
  const suffixIdx = ext && name.toLowerCase().endsWith(`.${ext}`) ? name.length - (ext.length + 1) : -1;
  const suffix = suffixIdx >= 0 ? name.slice(suffixIdx) : '';
  const base = suffixIdx >= 0 ? name.slice(0, suffixIdx) : name;
  const budget = Math.max(16, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  const kept = truncateUtf8(base, budget).replace(/[. ]+$/g, '');

  const finalName = `${kept || opts.fallbackBase}${suffix}`;
  return finalName || `${opts.fallbackBase}.${ext}`;
}

/**
 * 重名追加 `(2)`、`(3)`。
 *
 * 为什么必须做：同一个月里"发票.pdf"可能有十几份（从邮箱批量下载下来的名字都一样）。
 * 不追加的话解压时会覆盖，用户以为下载齐了，实际只剩最后一张。
 * 大小写不敏感比较：Windows / macOS 的默认文件系统都不区分大小写。
 */
export function dedupeZipEntryName(name: string, used: Set<string>): string {
  const key = name.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${base}(${i})${ext}`;
    const k = candidate.toLowerCase();
    if (!used.has(k)) {
      used.add(k);
      return candidate;
    }
  }
  const fallback = `${base}(${Date.now()})${ext}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

export interface InvoiceZip {
  stream: ReadableStream<Uint8Array>;
  /** 建议的下载文件名（进 Content-Disposition） */
  fileName: string;
  /** 实际打进去的文件数（不含缺失清单） */
  fileCount: number;
  /** 缺了多少份（>0 时包里会有 `_缺失清单.txt`） */
  missingCount: number;
}

function missingLine(ref: InvoiceFileRef, reason: string): string {
  return `${ref.invoiceNo}\t${ref.originalName}\t${reason}`;
}

/**
 * 打包。
 *
 * 抛错（都在写响应头之前）：无一可下载 → 40001；超数量/体积 → 41301（带实际值）。
 * 一旦返回了 stream，任何条目读失败都会 `destroy` 整个流 —— 这比继续吐一个
 * 残缺 ZIP 安全（用户解压后少几张票却以为齐了，是比"下载失败"严重得多的错）。
 */
export async function buildInvoiceZip(
  query: Omit<InvoiceListQuery, 'page'>,
  opts: { fileName?: string } = {},
): Promise<InvoiceZip> {
  // 别名必须给 i2：子查询是 `SELECT i2.id FROM invoices i2 <where>`
  const { where, params } = invoiceWhere(query, 'i2');
  const refs = await listFilesForZip(where, params);

  // 勾选下载与筛选下载的文案要分开：勾选模式下"把日期放宽一点"是句废话，
  // 用户要的动作是"少勾几张"或"给这几张传原件"
  const byPick = (query.ids?.length ?? 0) > 0;
  const tooMuchHint = byPick ? '少勾几张，分两批下。' : '先用日期或销售方把范围筛小一点。';

  if (refs.length === 0) {
    throw new AppError(
      40001,
      byPick
        ? `勾选的 ${query.ids!.length} 张发票都没有原件可下载。先在发票详情里「补原件」，或取消勾选后再试。`
        : '这次筛选出来的发票都没有原件可下载。先上传原件，或者把日期范围放宽一点。',
      400,
    );
  }

  // 同一份物理文件可能被多行引用（多页 PDF 识别出 3 张票）：包里只放一份
  const seen = new Set<string>();
  const unique: InvoiceFileRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.storageKey)) continue;
    seen.add(ref.storageKey);
    unique.push(ref);
  }

  if (unique.length > ZIP_MAX_FILES) {
    const bytes = unique.reduce((s, r) => s + r.sizeBytes, 0);
    throw new AppError(
      41301,
      `这次要下 ${unique.length} 份（${humanSize(bytes)}），一次最多 ${ZIP_MAX_FILES} 份 / 2GB。${tooMuchHint}`,
      413,
    );
  }
  const totalBytes = unique.reduce((s, r) => s + r.sizeBytes, 0);
  if (totalBytes > ZIP_MAX_BYTES) {
    throw new AppError(
      41301,
      `这次要下 ${unique.length} 份（${humanSize(totalBytes)}），一次最多 ${ZIP_MAX_FILES} 份 / 2GB。${tooMuchHint}`,
      413,
    );
  }

  // 预检：本地文件是否真的在盘上、大小对不对。这一步必须在写响应头之前完成
  const available: InvoiceFileRef[] = [];
  const missing: string[] = [];
  for (const ref of unique) {
    if (ref.sizeBytes <= 0) {
      missing.push(missingLine(ref, '库里记录的文件大小是 0，原件可能已损坏'));
      continue;
    }
    const state = await localFileState(ref);
    if (!state.ok) {
      missing.push(missingLine(ref, state.reason));
      continue;
    }
    available.push(ref);
  }

  if (available.length === 0) {
    throw new AppError(
      40001,
      `这次的 ${missing.length} 份原件都找不到了（磁盘或对象存储里没有对应文件）。联系管理员检查存储目录，或重新上传原件。`,
      400,
    );
  }

  const zipfile = new ZipFile();
  const used = new Set<string>();
  const mtime = new Date();

  // yazl 的条目错误（读流失败 / 尺寸与声明不符）是以 `error` 事件抛在 ZipFile 上的，
  // **不挂在 outputStream 上**。不接这个监听，Node 会把"未处理的 error 事件"直接抛出
  // 进程 —— 一次坏文件就能把整个服务打挂。接住之后统一表现为"连接中断"，
  // 浏览器报下载失败，用户重试即可（这比吐一个残缺包安全）。
  zipfile.on('error', (err: unknown) => {
    const out = zipfile.outputStream as unknown as Readable;
    if (!out.destroyed) out.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  for (const ref of available) {
    const name = dedupeZipEntryName(
      sanitizeZipEntryName(ref.originalName, { fallbackBase: ref.invoiceNo, ext: ref.ext }),
      used,
    );
    zipfile.addReadStreamLazy(name, { size: ref.sizeBytes, compress: false, mtime }, (cb) => {
      openInvoiceFileStream(ref)
        .then((s) => cb(null, s))
        .catch((err: unknown) => {
          // 这个条目读不出来：整包中止比吐残缺包安全（见文件头）
          cb(err instanceof Error ? err : new Error(String(err)), null as never);
        });
    });
  }

  if (missing.length > 0) {
    const body = [
      '下面这些原件没能打进这个包。把文件名发给管理员，或重新上传一次。',
      `导出时间：${mtime.toISOString()}`,
      `缺失数量：${missing.length}`,
      '',
      '发票号码\t文件名\t原因',
      ...missing,
      '',
    ].join('\n');
    // UTF-8 无 BOM：Excel 打开会认成 ANSI（中文乱码），所以提示用记事本/VS Code 看
    zipfile.addBuffer(Buffer.from(body, 'utf8'), ZIP_MISSING_LIST_NAME, { compress: false, mtime });
  }

  zipfile.end();

  const fileName = opts.fileName ?? `发票原件-${available.length}份.zip`;
  return {
    // yazl 的 outputStream 是 Node Readable；Next 要 Web ReadableStream
    stream: Readable.toWeb(zipfile.outputStream as Readable) as unknown as ReadableStream<Uint8Array>,
    fileName,
    fileCount: available.length,
    missingCount: missing.length,
  };
}
