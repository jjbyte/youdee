/**
 * 把一份合同附件的**字节**取出来（在线预览用）。
 *
 * 为什么单独成一个模块：本地读盘和云存储读对象是两条完全不同的路，
 * 而"读哪、怎么读"只有这里一处。散在预览路由里各写一份，
 * 迟早出现"本地能预览、云上不行"这种只在生产复现的差异。
 *
 * 与下载路由（`.../raw`）的分工：
 *   raw     → 302 到预签名地址，浏览器直连，适合下载和 PDF/图片内联
 *   content → 同源吐字节，给前端解析器用（docx-preview 必须 `fetch` 到字节）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../http';
import { getContractFileRef } from './contract.service';
import { uploadRoot } from './upload.service';
import { getCosObject } from './storage.service';

/**
 * 在线预览的大小上限。
 *
 * 与上传不同，预览必须把整份文件交给解析器：一个 200MB 的扫描 PDF 或者
 * 塞满图片的 docx，解析时占的内存是文件本身的好几倍，浏览器那一下会直接卡死，
 * 用户只会看到"页面无响应"。所以宁可明确拒绝并引导下载，也不要假装能预览。
 * 需要放宽就设 PREVIEW_MAX_BYTES（字节）。
 */
export const PREVIEW_MAX_BYTES = Number(process.env.PREVIEW_MAX_BYTES ?? 32 * 1024 * 1024);

function tooLarge(bytes: number, limit: number): AppError {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  return new AppError(
    41302,
    `这份附件 ${mb(bytes)}，超过在线预览的 ${mb(limit)} 上限。请下载后用本地软件打开。`,
    413,
  );
}

export async function readContractFileBytes(
  contractId: string,
  fileId: string,
  maxBytes: number = PREVIEW_MAX_BYTES,
): Promise<{ ref: Awaited<ReturnType<typeof getContractFileRef>>; buf: Buffer }> {
  const ref = await getContractFileRef(contractId, fileId);
  // 先用库里记的大小挡一道：云存储上真要拉 200MB 下来再发现超限，带宽已经花掉了
  if (ref.sizeBytes > maxBytes) throw tooLarge(ref.sizeBytes, maxBytes);

  let buf: Buffer;
  if (ref.storage === 'local') {
    const root = uploadRoot();
    const abs = path.resolve(/*turbopackIgnore: true*/ root, ref.storageKey);
    // 键来自库，理论上不会穿越；但"理论上"不该是唯一防线
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new AppError(40401, '这份附件的位置不合法。', 404);
    }
    try {
      buf = await readFile(/*turbopackIgnore: true*/ abs);
    } catch {
      throw new AppError(40401, '附件文件已经不在了（可能被清理任务回收过），重新上传一份吧。', 404);
    }
  } else {
    buf = await getCosObject(ref.storageKey);
  }

  // 库里的大小是上传那一刻记的，可能和真实字节不一致（历史数据、中断的上传），
  // 所以拿到真东西之后再卡一次。这一道才是真正生效的。
  if (buf.byteLength > maxBytes) throw tooLarge(buf.byteLength, maxBytes);
  return { ref, buf };
}
