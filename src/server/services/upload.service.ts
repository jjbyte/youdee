/**
 * 附件落盘。
 *
 * 类型判断只看**文件头魔数**，不信任 Content-Type：客户端把 .exe 改名成 .png
 * 并声明 image/png 是最省事的上传绕过方式，而这类文件进了 public/ 就等于被托管。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../http';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5_242_880);
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'var/uploads';

type Allowed = { mime: string; ext: string };

function sniff(buf: Buffer): Allowed | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.length >= 12
    && buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  return null;
}

export interface SavedFile {
  storageKey: string;
  url: string;
  mime: string;
  sizeBytes: number;
  originalName: string;
  kind: 'image' | 'file';
}

export async function saveUpload(file: File, subdir: string): Promise<SavedFile> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) throw new AppError(40001, '上传的文件是空的。', 400, { field: 'file' });
  if (buf.byteLength > MAX_BYTES) {
    throw new AppError(41301, `文件超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限。`, 413, { field: 'file' });
  }
  const allowed = sniff(buf);
  if (!allowed) {
    throw new AppError(41501, '只支持 JPG / PNG / WEBP 图片与 PDF。', 415, { field: 'file' });
  }
  const dir = path.join(process.cwd(), UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${allowed.ext}`;
  await writeFile(path.join(dir, name), buf);
  return {
    storageKey: `${subdir}/${name}`,
    url: `/uploads/${subdir}/${name}`,
    mime: allowed.mime,
    sizeBytes: buf.byteLength,
    originalName: file.name || name,
    kind: allowed.mime === 'application/pdf' ? 'file' : 'image',
  };
}

/** 附件 URL：库里可能已经带域名，也可能是相对路径，统一成前端可直接用的形式 */
export function assetUrl(stored: string): string {
  if (/^https?:\/\//i.test(stored)) return stored;
  return stored.startsWith('/') ? stored : `/${stored}`;
}
