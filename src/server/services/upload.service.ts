/**
 * 附件落盘。
 *
 * 类型判断全部交给 `file-type.ts`，只看**文件字节**：客户端把 .exe 改名成 .png
 * 并声明 image/png 是最省事的上传绕过方式，而这类文件进了上传目录就等于被托管。
 * 判定与 `accept` 白名单分开：判定回答"它到底是什么"，白名单回答"这个位置收不收"。
 */
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../http';
import { detectFileType, normalizeExt, type FileExt } from './file-type';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5_242_880);
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'var/uploads';

/**
 * 上传根目录（绝对路径）。
 *
 * 导出是给"流式上传"和下载路由用的：三处必须指向同一个目录，
 * 各写一份 `process.env.UPLOAD_DIR ?? 'var/uploads'` 的后果是
 * 上传写 A、下载读 B，现象是"传成功了但点开 404"。
 */
export function uploadRoot(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), UPLOAD_DIR);
}

/** 默认白名单：价格附件这类"截图 / 扫描件"场景够用 */
const DEFAULT_ACCEPT: readonly FileExt[] = ['jpg', 'png', 'webp', 'pdf'];
const DEFAULT_ACCEPT_LABEL = 'JPG / PNG / WEBP 图片与 PDF';

export interface SavedFile {
  storageKey: string;
  url: string;
  mime: string;
  sizeBytes: number;
  originalName: string;
  kind: 'image' | 'file';
}

export async function saveUpload(
  file: File,
  subdir: string,
  /**
   * 上限默认取 MAX_UPLOAD_BYTES（图片 / 报价截图这类够用）。
   * 合同扫描件是例外：一份十页的扫描 PDF 很容易 8~15MB，用 5MB 卡它等于
   * 逼人先拆页再传。调用方显式给一个更大的值，而不是把全局上限抬高——
   * 抬高全局上限等于让所有上传口都放开。
   *
   * `accept` 是这个上传口允许的扩展名集合（已按真实类型归一过）。
   */
  opts: { maxBytes?: number; accept?: readonly FileExt[]; acceptLabel?: string } = {},
): Promise<SavedFile> {
  const limit = opts.maxBytes ?? MAX_BYTES;
  const accept = opts.accept ?? DEFAULT_ACCEPT;
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) throw new AppError(40001, '上传的文件是空的。', 400, { field: 'file' });
  if (buf.byteLength > limit) {
    throw new AppError(41301, `文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限。`, 413, { field: 'file' });
  }

  const probe = detectFileType(buf);
  if (!probe.ok) {
    // 宏 / 加密 / 认不出：给判定阶段的具体原因，比一句"格式不对"有用
    throw new AppError(41501, probe.hint, 415, { field: 'file' });
  }
  const type = probe.type;
  if (!accept.includes(type.ext)) {
    throw new AppError(
      41501,
      `这个地方只收${opts.acceptLabel ?? DEFAULT_ACCEPT_LABEL}，你传的是 ${type.label}。`,
      415,
      { field: 'file' },
    );
  }

  // 三处 turbopackIgnore：上传目录来自 UPLOAD_DIR，构建期是动态路径。
  // 不标的话 Turbopack 会把整工程都追踪进 server 产物（构建慢、体积大），
  // 而这里读写的都是运行期才存在的文件，构建期追踪没有意义。
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${type.ext}`;
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf);
  return {
    storageKey: `${subdir}/${name}`,
    url: `/uploads/${subdir}/${name}`,
    mime: type.mime,
    sizeBytes: buf.byteLength,
    originalName: file.name || name,
    kind: type.kind,
  };
}

/** 把客户端给的扩展名归一成白名单里的写法；不认识返回 null */
export function acceptExt(name: string): FileExt | null {
  const i = name.lastIndexOf('.');
  if (i < 0) return null;
  return normalizeExt(name.slice(i + 1));
}

/** 附件 URL：库里可能已经带域名，也可能是相对路径，统一成前端可直接用的形式 */
export function assetUrl(stored: string): string {
  if (/^https?:\/\//i.test(stored)) return stored;
  return stored.startsWith('/') ? stored : `/${stored}`;
}

/**
 * 落盘一段已经校验过的二进制（目前只有模板 xlsx 用）。
 *
 * 与 `saveUpload` 分开：那个的类型判断是图片/PDF 白名单，xlsx 的魔数是 ZIP，
 * 直接把 ZIP 加进白名单等于允许上传任意压缩包。xlsx 的校验在
 * `template-file.service.assertXlsx` 里单独做，做到结构级。
 */
export async function saveBuffer(buf: Buffer, subdir: string, ext: string): Promise<{ storageKey: string }> {
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf);
  return { storageKey: `${subdir}/${name}` };
}

/**
 * 把一个已经落盘的临时文件移进上传目录。
 *
 * 与 `saveUpload` 的区别只有一点：**不碰内存**。大附件走这条路，
 * 因为它传进来时已经在磁盘上了，再读一遍 Buffer 等于把前面省的又还回去。
 *
 * EXDEV：临时目录可能在 /tmp（另一个文件系统），rename 会跨设备失败。
 * 这时退化成 copy + unlink —— 直接抛 EXDEV 的话，现象是"本机能传、生产传不了"。
 */
export async function persistLocalFile(
  tmpPath: string,
  subdir: string,
  ext: string,
): Promise<{ storageKey: string; url: string }> {
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  const target = path.join(/*turbopackIgnore: true*/ dir, name);
  try {
    await rename(tmpPath, target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await copyFile(tmpPath, target);
    await unlink(tmpPath).catch(() => {});
  }
  return { storageKey: `${subdir}/${name}`, url: `/uploads/${subdir}/${name}` };
}

