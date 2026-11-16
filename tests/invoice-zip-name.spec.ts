import { describe, expect, it } from 'vitest';
import {
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  ZIP_MISSING_LIST_NAME,
  ZIP_NAME_MAX_BYTES,
  dedupeZipEntryName,
  sanitizeZipEntryName,
} from '@/server/services/invoice-zip.service';
import { contentDisposition } from '@/server/services/export.service';

/**
 * ZIP 条目名清洗。
 *
 * 这些规则不是"美观"问题，每一条都对应一次真实故障：
 *   - Windows 非法字符 → 解压出来是乱码或被系统改名，用户按名字找不到票；
 *   - 结尾的点 → Windows 静默吃掉，「1130.00.pdf」变成「1130.00」；
 *   - 不截断 → 单段路径超 255 字节，解压直接报"文件名太长"，整包作废；
 *   - 重名不追加 → 解压时覆盖，用户以为下载齐了，实际只剩最后一张。
 */
describe('文件名清洗（sanitizeZipEntryName）', () => {
  it('正常中文名原样保留', () => {
    expect(sanitizeZipEntryName('发票-2026年3月.pdf', { fallbackBase: '00000012', ext: 'pdf' })).toBe(
      '发票-2026年3月.pdf',
    );
  });

  it('Windows 非法字符（\\ / : * ? " < > |）全部换成下划线', () => {
    const cleaned = sanitizeZipEntryName('a\\b/c:d*e?f"g<h>i|j.pdf', { fallbackBase: '00000012', ext: 'pdf' });
    expect(cleaned).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    expect(cleaned).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('控制字符与换行被清掉（OCR 传来的原始文件名里真的会有 \\n）', () => {
    expect(sanitizeZipEntryName('发\u0000票\n原件\r.pdf', { fallbackBase: '00000012', ext: 'pdf' })).toBe(
      '发票原件.pdf',
    );
  });

  it('结尾的点和空格必须去掉（Windows 会静默吃掉，名字对不上）', () => {
    expect(sanitizeZipEntryName('1130.00...  ', { fallbackBase: '00000012', ext: 'pdf' })).toBe('1130.00.pdf');
  });

  it('清完为空 → 回落「发票号.扩展名」', () => {
    expect(sanitizeZipEntryName('', { fallbackBase: '00000012', ext: 'pdf' })).toBe('00000012.pdf');
    expect(sanitizeZipEntryName('***', { fallbackBase: '00000012', ext: 'jpg' })).toBe('___.jpg');
    expect(sanitizeZipEntryName('...', { fallbackBase: '00000012', ext: 'png' })).toBe('00000012.png');
  });

  it('没有扩展名就补上（解压后双击能不能打开全靠它）', () => {
    expect(sanitizeZipEntryName('三月发票', { fallbackBase: '00000012', ext: 'pdf' })).toBe('三月发票.pdf');
  });

  it('已有同扩展名不重复追加（jpeg 归一后也算）', () => {
    expect(sanitizeZipEntryName('发票.PDF', { fallbackBase: '00000012', ext: 'pdf' })).toBe('发票.PDF');
  });

  it('按 UTF-8 **字节**截断到 120 字节，且不切断汉字', () => {
    const long = `${'发'.repeat(100)}.pdf`; // 300 + 4 字节
    const cleaned = sanitizeZipEntryName(long, { fallbackBase: '00000012', ext: 'pdf' });
    expect(Buffer.byteLength(cleaned, 'utf8')).toBeLessThanOrEqual(ZIP_NAME_MAX_BYTES);
    // 没有半个汉字（替换字符）出现，扩展名还在
    expect(cleaned).not.toContain('\uFFFD');
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });

  it('截断后仍保留扩展名（不能把 120 字节全给主名）', () => {
    const long = `${'a'.repeat(300)}.jpg`;
    const cleaned = sanitizeZipEntryName(long, { fallbackBase: '00000012', ext: 'jpg' });
    expect(cleaned.endsWith('.jpg')).toBe(true);
    expect(Buffer.byteLength(cleaned, 'utf8')).toBeLessThanOrEqual(ZIP_NAME_MAX_BYTES);
  });
});

describe('重名追加 (2)(3)', () => {
  it('同名三份依次变成 (2) 和 (3)', () => {
    const used = new Set<string>();
    expect(dedupeZipEntryName('发票.pdf', used)).toBe('发票.pdf');
    expect(dedupeZipEntryName('发票.pdf', used)).toBe('发票(2).pdf');
    expect(dedupeZipEntryName('发票.pdf', used)).toBe('发票(3).pdf');
  });

  it('大小写不敏感比较（Windows / macOS 默认文件系统不区分）', () => {
    const used = new Set<string>();
    expect(dedupeZipEntryName('Invoice.PDF', used)).toBe('Invoice.PDF');
    expect(dedupeZipEntryName('invoice.pdf', used)).toBe('invoice(2).pdf');
  });

  it('没有扩展名时也能追加', () => {
    const used = new Set<string>();
    expect(dedupeZipEntryName('发票', used)).toBe('发票');
    expect(dedupeZipEntryName('发票', used)).toBe('发票(2)');
  });
});

describe('包级别的上限与缺件清单', () => {
  it('上限是 500 份 / 2GB（超限 41301 由 service 给带实际值的文案）', () => {
    expect(ZIP_MAX_FILES).toBe(500);
    expect(ZIP_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  it('缺件清单固定叫 _缺失清单.txt（按名称排序时在最前）', () => {
    expect(ZIP_MISSING_LIST_NAME).toBe('_缺失清单.txt');
  });
});

describe('Content-Disposition（复用 export.service）', () => {
  it('同时给 ascii 回退与 filename* 双写', () => {
    const v = contentDisposition('发票原件-3份.zip');
    expect(v).toContain('attachment;');
    expect(v).toContain('filename="');
    // ascii 回退里不能有非 ASCII（旧下载器会把它当乱码）
    const ascii = /filename="([^"]*)"/.exec(v)?.[1] ?? '';
    expect(ascii).toMatch(/^[\x20-\x7E]*$/);
    // filename* 必须是 UTF-8 百分号编码
    expect(v).toContain(`filename*=UTF-8''${encodeURIComponent('发票原件-3份.zip')}`);
  });
});
