import { describe, it, expect } from 'vitest';
import { detectFileType, zipEntryNames, zipUncompressedSize, FILE_CATEGORY } from '../src/server/services/file-type';

/**
 * 造一个最小可解析的 ZIP：只为了让 `zipEntryNames` 读到条目名。
 * 内容不必是真的 Office 文档——类型判定只看目录里的文件名，
 * 这正是它比扩展名可靠的原因（客户端改扩展名不会改目录）。
 */
function makeZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from('x');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([lfh, nameBuf, data]);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cdh, nameBuf]));

    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** OLE2 复合文档：魔数 + 内部流名（UTF-16LE） */
function makeOle2(streams: string[]): Buffer {
  const head = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([head, ...streams.map((s) => Buffer.from(s, 'utf16le'))]);
}

describe('detectFileType —— 图片与 PDF', () => {
  it('认得出 JPG', () => {
    const r = detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    expect(r).toMatchObject({ ok: true, type: { ext: 'jpg', kind: 'image' } });
  });

  it('认得出 PNG', () => {
    const r = detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(r).toMatchObject({ ok: true, type: { ext: 'png' } });
  });

  it('认得出 PDF', () => {
    const r = detectFileType(Buffer.from('%PDF-1.7\n...'));
    expect(r).toMatchObject({ ok: true, type: { ext: 'pdf', kind: 'file' } });
  });

  it('空文件直接拒', () => {
    const r = detectFileType(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty');
  });

  it('可执行文件改名上传 → 认不出（这就是不信扩展名的意义）', () => {
    const r = detectFileType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });
});

describe('detectFileType —— Word / Excel', () => {
  it('docx：zip 里有 word/document.xml', () => {
    const r = detectFileType(makeZip(['[Content_Types].xml', 'word/document.xml']));
    expect(r).toMatchObject({ ok: true, type: { ext: 'docx', mime: expect.stringContaining('wordprocessingml') } });
  });

  it('xlsx：zip 里有 xl/workbook.xml', () => {
    const r = detectFileType(makeZip(['[Content_Types].xml', 'xl/workbook.xml']));
    expect(r).toMatchObject({ ok: true, type: { ext: 'xlsx' } });
  });

  it('老版 doc：OLE2 里有 WordDocument 流', () => {
    const r = detectFileType(makeOle2(['WordDocument', '1Table']));
    expect(r).toMatchObject({ ok: true, type: { ext: 'doc', mime: 'application/msword' } });
  });

  it('老版 xls：OLE2 里有 Workbook 流', () => {
    const r = detectFileType(makeOle2(['Workbook']));
    expect(r).toMatchObject({ ok: true, type: { ext: 'xls', mime: 'application/vnd.ms-excel' } });
  });

  it('带宏的 docm 被拒，且说明原因', () => {
    const r = detectFileType(makeZip(['word/document.xml', 'word/vbaProject.bin']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('macro');
      expect(r.hint).toContain('宏');
    }
  });

  it('加密的 OOXML 被拒', () => {
    const r = detectFileType(makeZip(['EncryptionInfo', 'EncryptedPackage']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('encrypted');
  });

  it('普通压缩包不能冒充 Word', () => {
    const r = detectFileType(makeZip(['photos/a.jpg', 'readme.txt']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('PPT 在提示里被点名', () => {
    const r = detectFileType(makeZip(['ppt/presentation.xml']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toContain('PPT');
  });

  it('rtf 存成 .doc 仍当 Word 收', () => {
    const r = detectFileType(Buffer.from('{\\rtf1\\ansi hello}'));
    expect(r).toMatchObject({ ok: true, type: { ext: 'doc' } });
  });
});

describe('zip 工具', () => {
  it('读得出条目名与解压后总大小', () => {
    const buf = makeZip(['a.txt', 'b/c.xml']);
    expect(zipEntryNames(buf)).toEqual(['a.txt', 'b/c.xml']);
    expect(zipUncompressedSize(buf)).toBe(2);
  });

  it('不是 zip 返回 null，不抛异常', () => {
    expect(zipEntryNames(Buffer.from('hello'))).toBeNull();
    expect(zipEntryNames(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(zipUncompressedSize(Buffer.alloc(10))).toBeNull();
  });
});

describe('分类白名单', () => {
  it('合同电子版不收 Excel', () => {
    expect(FILE_CATEGORY.contract.allow).not.toContain('xlsx');
    expect(FILE_CATEGORY.contract.allow).toContain('docx');
  });

  it('报价单电子版不收 Word', () => {
    expect(FILE_CATEGORY.quote.allow).not.toContain('docx');
    expect(FILE_CATEGORY.quote.allow).toContain('xlsx');
  });

  it('结算资料 Word 与 Excel 都收', () => {
    expect(FILE_CATEGORY.settlement.allow).toEqual(expect.arrayContaining(['docx', 'xlsx', 'pdf', 'jpg']));
  });
});
