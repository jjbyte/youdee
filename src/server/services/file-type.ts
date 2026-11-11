/**
 * 上传文件的类型判定（纯逻辑，只看字节）。
 *
 * 为什么不能信扩展名和 Content-Type：客户端把 `.exe` 改名成 `.pdf` 再声明
 * `application/pdf` 是最省事的上传绕过方式；而这些文件会从 `/uploads/*`
 * 被浏览器打开。
 *
 * 三类文件的判定方式不同：
 *   - 图片 / PDF：固定魔数，几字节就能判。
 *   - docx / xlsx：本质是 ZIP。只看 `PK\x03\x04` 会把任意压缩包放进来，
 *     所以要读 ZIP 中央目录里的文件名：有 `word/document.xml` 才是 Word，
 *     有 `xl/workbook.xml` 才是 Excel。
 *   - doc / xls（97-2003）：OLE2 复合文档，魔数只能说明"是个 Office 老文件"。
 *     具体是 Word 还是 Excel，看内部流的名字（`WordDocument` / `Workbook`），
 *     流名在文件里以 UTF-16LE 明文存储，扫一遍就能看到。
 *
 * 带宏的 docm / xlsm 直接拒：服务端不会执行宏，但让它进库就等于替用户
 * 保管一个他自己都说不清内容的文件。
 */

/** 支持的文件扩展名（内部统一用小写，jpeg 归一到 jpg） */
export type FileExt = 'jpg' | 'png' | 'webp' | 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx';

export interface FileType {
  ext: FileExt;
  mime: string;
  kind: 'image' | 'file';
  label: string;
}

export type Probe =
  | { ok: true; type: FileType }
  | { ok: false; code: 'empty' | 'unknown' | 'macro' | 'encrypted' | 'broken'; hint: string };

const TYPES: Record<FileExt, FileType> = {
  jpg: { ext: 'jpg', mime: 'image/jpeg', kind: 'image', label: 'JPG 图片' },
  png: { ext: 'png', mime: 'image/png', kind: 'image', label: 'PNG 图片' },
  webp: { ext: 'webp', mime: 'image/webp', kind: 'image', label: 'WEBP 图片' },
  pdf: { ext: 'pdf', mime: 'application/pdf', kind: 'file', label: 'PDF' },
  doc: { ext: 'doc', mime: 'application/msword', kind: 'file', label: 'Word 文档' },
  docx: {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'file',
    label: 'Word 文档',
  },
  xls: { ext: 'xls', mime: 'application/vnd.ms-excel', kind: 'file', label: 'Excel 工作簿' },
  xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'file',
    label: 'Excel 工作簿',
  },
};

/** 老式 .jpeg 归一成 jpg：库里存两套扩展名，下载路由就要维护两套 MIME */
function normalizeExt(ext: string): FileExt | null {
  const e = ext.toLowerCase();
  return (e === 'jpeg' ? 'jpg' : e) in TYPES ? ((e === 'jpeg' ? 'jpg' : e) as FileExt) : null;
}

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

function isOle2(buf: Buffer): boolean {
  return (
    buf.length >= 8
    && buf[0] === 0xd0
    && buf[1] === 0xcf
    && buf[2] === 0x11
    && buf[3] === 0xe0
    && buf[4] === 0xa1
    && buf[5] === 0xb1
    && buf[6] === 0x1a
    && buf[7] === 0xe1
  );
}

/**
 * 读 ZIP 中央目录里的文件名。不是 ZIP 或目录损坏时返回 null。
 *
 * 只取名字，不解压：判定类型不需要内容，解压反而给了 zip bomb 机会。
 * 大小的检查在 `assertZipBudget`（合同附件用它挡超大解压）。
 */
export function zipEntryNames(buf: Buffer): string[] | null {
  if (!isZip(buf) || buf.length < 22) return null;
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    if (off + 46 + nameLen > buf.length) break;
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** ZIP 解压后总字节数（读中央目录里的 uncompressed 字段，不解压）。不是 ZIP 返回 null */
export function zipUncompressedSize(buf: Buffer): number | null {
  if (!isZip(buf) || buf.length < 22) return null;
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    total += buf.readUInt32LE(off + 24);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

/** 在字节流里找 UTF-16LE 编码的字符串（OLE2 的目录项就是这么存的） */
function hasUtf16le(buf: Buffer, s: string): boolean {
  const needle = Buffer.from(s, 'utf16le');
  return buf.indexOf(needle) !== -1;
}

function containsAscii(buf: Buffer, s: string, limit = 4096): boolean {
  // ZIP 的文件名在头部附近，只扫前若干 KB 足够，避免在大文件上做全量搜索
  return buf.subarray(0, Math.min(buf.length, limit)).includes(Buffer.from(s, 'ascii'));
}

/**
 * 判定上传文件的真实类型。
 *
 * @param buf 文件字节
 */
export function detectFileType(buf: Buffer): Probe {
  if (buf.length === 0) return { ok: false, code: 'empty', hint: '文件是空的。' };

  // 图片与 PDF：固定魔数
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ok: true, type: TYPES.jpg };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ok: true, type: TYPES.png };
  }
  if (
    buf.length >= 12
    && buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ok: true, type: TYPES.webp };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { ok: true, type: TYPES.pdf };

  // 极少数 .doc 其实是 RTF（Word 能打开）。当 Word 收，但明确标注
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '{\\rtf') {
    return { ok: true, type: TYPES.doc };
  }

  if (isZip(buf)) {
    const names = zipEntryNames(buf);
    if (!names) {
      return { ok: false, code: 'broken', hint: '这个压缩包读不出目录，可能已损坏。用 Office 打开后另存一份再传。' };
    }
    // 宏：.docm / .xlsm 的 vbaProject.bin 在 word/ 或 xl/ 下
    if (names.some((n) => /^(word|xl)\/vbaProject\.bin$/i.test(n))) {
      return { ok: false, code: 'macro', hint: '这个文件带宏。请另存为普通 .docx / .xlsx 再上传——服务端不会执行宏。' };
    }
    if (names.includes('word/document.xml')) return { ok: true, type: TYPES.docx };
    if (names.includes('xl/workbook.xml')) return { ok: true, type: TYPES.xlsx };
    // 加密的 OOXML：ZIP 里只有一个 EncryptedPackage
    if (names.some((n) => /EncryptedPackage/i.test(n))) {
      return { ok: false, code: 'encrypted', hint: '这个文件加了密码，服务端打不开。请另存一份不加密的再上传。' };
    }
    return {
      ok: false,
      code: 'unknown',
      hint: `这个压缩包不是 Word 或 Excel 文档${containsAscii(buf, 'ppt/') ? '（看起来是 PPT，不在支持范围内）' : ''}。`,
    };
  }

  if (isOle2(buf)) {
    // 97-2003 的 doc / xls 都是 OLE2，靠内部流名区分
    if (hasUtf16le(buf, 'WordDocument')) return { ok: true, type: TYPES.doc };
    if (hasUtf16le(buf, 'Workbook') || hasUtf16le(buf, 'Book')) return { ok: true, type: TYPES.xls };
    if (hasUtf16le(buf, 'EncryptedPackage') || hasUtf16le(buf, 'EncryptionInfo')) {
      return { ok: false, code: 'encrypted', hint: '这个文件加了密码，服务端打不开。请另存一份不加密的再上传。' };
    }
    return {
      ok: false,
      code: 'unknown',
      hint: '这个文件不是 Word / Excel 文档（可能是 PPT 或已损坏）。',
    };
  }

  return { ok: false, code: 'unknown', hint: '认不出这个文件的格式，改成 PDF 或 JPG 再试。' };
}

/** 按扩展名归一（用于提示文案，不用于判定） */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export { normalizeExt };

/** 供前端与接口复用的分类定义：三个抽屉各自收什么 */
export const FILE_CATEGORY = {
  contract: {
    label: '合同电子版',
    allow: ['pdf', 'jpg', 'png', 'webp', 'doc', 'docx'] as const,
    hint: 'PDF / JPG / PNG / Word',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx',
  },
  quote: {
    label: '报价单电子版',
    allow: ['pdf', 'jpg', 'png', 'webp', 'xls', 'xlsx'] as const,
    hint: 'PDF / JPG / PNG / Excel',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx',
  },
  settlement: {
    label: '结算资料',
    allow: ['pdf', 'jpg', 'png', 'webp', 'xls', 'xlsx', 'doc', 'docx'] as const,
    hint: 'PDF / JPG / PNG / Excel / Word',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx',
  },
} as const;

export type FileCategory = keyof typeof FILE_CATEGORY;

export function isFileCategory(v: unknown): v is FileCategory {
  return v === 'contract' || v === 'quote' || v === 'settlement';
}
