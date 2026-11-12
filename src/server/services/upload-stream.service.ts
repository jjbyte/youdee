/**
 * 上传的"落地"阶段：把请求体字节流先写成临时文件，判完类型再决定去哪儿。
 *
 * 为什么不再用 `req.formData()` + `file.arrayBuffer()`：
 * 附件去掉单份大小限制之后，整份读进内存就等于给每个上传并发开一个
 * "文件大小"大小的内存洞。2GB 的扫描件足以让整个 Node 进程 OOM 消失，
 * 而现象只是"上传到一半服务没了"。流式写盘是唯一稳的做法。
 *
 * 顺序也是有讲究的：
 *   1. 先落临时文件（字节全在盘上，不占内存）；
 *   2. 再判类型（小文件读全量精确判，大文件头尾各读一段）；
 *   3. 判定通过才移进 UPLOAD_DIR 或上传到 COS。
 * 任何一步失败都删临时文件——临时目录堆满磁盘这件事，往往等发现就晚了。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../http';
import { detectFileType, detectFileTypePartial, type FileType } from './file-type';

/** 临时目录：放在系统 tmp 下，和 UPLOAD_DIR 分开，方便单独清理 */
const TMP_ROOT = path.join(os.tmpdir(), 'youdee-upload');

/** 判类型时保留的头部字节数：足够覆盖所有魔数与 ZIP 前几个条目名 */
const HEAD_BYTES = 1024 * 1024;
/** 尾部字节数：docx/xlsx 的中央目录在这里 */
const TAIL_BYTES = 1024 * 1024;
/** 小于这个体积就整份读进来判（精确，且不会把内存撑爆） */
const FULL_DETECT_MAX = 16 * 1024 * 1024;

export interface StagedUpload {
  tmpPath: string;
  sizeBytes: number;
  originalName: string;
  type: FileType;
}

function humanSize(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  return `${Math.round(n / 1024 / 1024)}MB`;
}

/**
 * 把一个请求体流写成临时文件并判定类型。
 *
 * @param stream    Request 的 body（Web ReadableStream）
 * @param opts.originalName 原始文件名（只用于展示与提示，不参与落盘命名）
 * @param opts.maxBytes 应用层上限，0 / 不传 = 不限制
 */
export async function stageUploadStream(
  stream: ReadableStream<Uint8Array> | null,
  opts: { originalName: string; maxBytes?: number },
): Promise<StagedUpload> {
  if (!stream) throw new AppError(40001, '没有收到文件内容。', 400, { field: 'file' });

  await mkdir(TMP_ROOT, { recursive: true });
  const tmpPath = path.join(TMP_ROOT, `${randomUUID()}.part`);
  const maxBytes = opts.maxBytes ?? 0;

  let size = 0;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);

  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (maxBytes > 0 && size > maxBytes) {
        // 超限就地中止：继续收完再拒，等于把带宽和磁盘都白送一遍
        cb(new AppError(41301, `文件超过 ${humanSize(maxBytes)} 上限。`, 413, { field: 'file' }));
        return;
      }
      if (head.length < HEAD_BYTES) {
        const need = HEAD_BYTES - head.length;
        head = Buffer.concat([head, chunk.subarray(0, Math.min(need, chunk.length))]);
      }
      // 只留最后 TAIL_BYTES：Buffer.from 复制一份，避免 subarray 持续引用
      // 整个 chunk（那样等于把整个文件都留在内存里，白做流式）
      tail = tail.length + chunk.length <= TAIL_BYTES
        ? Buffer.concat([tail, chunk])
        : Buffer.from(Buffer.concat([tail, chunk]).subarray(-TAIL_BYTES));
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(tmpPath),
    );
  } catch (e) {
    await rm(tmpPath, { force: true });
    if (e instanceof AppError) throw e;
    throw new AppError(40001, '文件没传完就断了，重传一次。', 400, { field: 'file' });
  }

  if (size === 0) {
    await rm(tmpPath, { force: true });
    throw new AppError(40001, '上传的文件是空的。', 400, { field: 'file' });
  }

  try {
    const probe = size <= FULL_DETECT_MAX
      ? detectFileType(await readFile(tmpPath))
      : detectFileTypePartial(head, tail.length > 0 ? tail : null, size);
    if (!probe.ok) {
      // 宏 / 加密 / 认不出：把判定阶段的具体原因原样给出去，比"格式不对"有用
      throw new AppError(41501, probe.hint, 415, { field: 'file' });
    }
    return { tmpPath, sizeBytes: size, originalName: opts.originalName || '未命名文件', type: probe.type };
  } catch (e) {
    await rm(tmpPath, { force: true });
    if (e instanceof AppError) throw e;
    throw new AppError(40001, '这个文件读不出来，可能已经损坏。', 400, { field: 'file' });
  }
}

/** 用完即删。调用方在"已落盘/已上传"之后再删，顺序反了就没有可回滚的东西 */
export async function discardStaged(staged: StagedUpload | null): Promise<void> {
  if (!staged) return;
  await rm(staged.tmpPath, { force: true });
}
