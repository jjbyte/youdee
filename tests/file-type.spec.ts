import { describe, it, expect } from 'vitest';
import {
  detectFileType,
  detectFileTypePartial,
  zipEntryNames,
  zipUncompressedSize,
  FILE_CATEGORY,
} from '../src/server/services/file-type';

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

/**
 * 大文件判定：只给头尾两段。
 *
 * 附件去掉单份大小限制后，这条路是唯一能判类型又不 OOM 的方式。
 * 这里守三个"只在这种时候才会暴露"的错：
 *   1. 尾部窗口里的中央目录偏移没换算（大 docx 认不出，小文件全对）；
 *   2. OLE2 的目录扇区落在尾部（大 .doc 被当成"不是 Office"）；
 *   3. 拿不到中央目录就瞎猜（等于把任意 ZIP 收进来）。
 */
describe('detectFileTypePartial —— 大文件只看头尾', () => {
  /** 造一个指定体积的 ZIP（未压缩存储），用来模拟几百 MB 的 docx */
  function makeBigZip(names: string[], payloadBytes: number): Buffer {
    const nameBuf = Buffer.from(names[0]!, 'utf8');
    const data = Buffer.alloc(payloadBytes, 0x78);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([lfh, nameBuf, data]);

    const centrals = names.map((n, i) => {
      const nb = Buffer.from(n, 'utf8');
      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(20, 4);
      cdh.writeUInt16LE(20, 6);
      cdh.writeUInt32LE(data.length, 20);
      cdh.writeUInt32LE(data.length, 24);
      cdh.writeUInt16LE(nb.length, 28);
      // 所有条目都指向第一个本地头：本测试只关心"名字读得出来"
      cdh.writeUInt32LE(0, 42);
      return Buffer.concat([cdh, nb, i === 0 ? Buffer.alloc(0) : Buffer.alloc(0)]);
    });
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(names.length, 8);
    eocd.writeUInt16LE(names.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, cd, eocd]);
  }

  const MB = 1024 * 1024;

  it('大 docx：中央目录在尾部，换算偏移后能认出', () => {
    const buf = makeBigZip(['word/document.xml'], 3 * MB);
    const head = buf.subarray(0, MB);
    const tail = buf.subarray(buf.length - MB);
    expect(detectFileTypePartial(head, tail, buf.length)).toMatchObject({ ok: true, type: { ext: 'docx' } });
  });

  it('大 xlsx 同理', () => {
    const buf = makeBigZip(['xl/workbook.xml'], 2 * MB);
    expect(
      detectFileTypePartial(buf.subarray(0, MB), buf.subarray(buf.length - MB), buf.length),
    ).toMatchObject({ ok: true, type: { ext: 'xlsx' } });
  });

  it('尾部拿不到时退回头部条目名：能确认就收，认不出就拒', () => {
    const docx = makeBigZip(['word/document.xml'], 2 * MB);
    expect(detectFileTypePartial(docx.subarray(0, MB), null, docx.length)).toMatchObject({
      ok: true,
      type: { ext: 'docx' },
    });

    const plain = makeBigZip(['notes.txt'], 2 * MB);
    const r = detectFileTypePartial(plain.subarray(0, MB), null, plain.length);
    expect(r.ok).toBe(false);
    // 不能静默当 Office 收下——那样任意 ZIP 都能伪装成合同
    expect(r).toMatchObject({ ok: false, code: 'unknown' });
  });

  it('大文件里的宏仍然被拦（尾部中央目录里有 vbaProject.bin）', () => {
    const buf = makeBigZip(['word/document.xml', 'word/vbaProject.bin'], 2 * MB);
    const r = detectFileTypePartial(buf.subarray(0, MB), buf.subarray(buf.length - MB), buf.length);
    expect(r).toMatchObject({ ok: false, code: 'macro' });
  });

  it('连尾部都读不到时只认头部：认得出 docx 但看不到更深的条目名（已知边界）', () => {
    // 这是头部探测的能力边界，不是 bug：中央目录超过 1MB 才会走到这里，
    // 那种文件的条目名可能全在头部窗口之外。服务端从不执行宏，只做下载，
    // 所以这里接受它，并在 file-type.ts 的注释里写清楚。
    const buf = makeBigZip(['word/document.xml', 'word/vbaProject.bin'], 2 * MB);
    expect(detectFileTypePartial(buf.subarray(0, MB), null, buf.length)).toMatchObject({
      ok: true,
      type: { ext: 'docx' },
    });
  });

  it('大 .doc（OLE2）：目录扇区在尾部也能认出', () => {
    const magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const buf = Buffer.concat([magic, Buffer.alloc(3 * MB), Buffer.from('WordDocument', 'utf16le')]);
    const head = buf.subarray(0, MB);
    const tail = buf.subarray(buf.length - MB);
    expect(detectFileTypePartial(head, tail, buf.length)).toMatchObject({ ok: true, type: { ext: 'doc' } });
  });

  it('图片 / PDF 只看头部魔数，不需要尾部', () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * MB)]);
    expect(detectFileTypePartial(pdf.subarray(0, MB), null, pdf.length)).toMatchObject({
      ok: true,
      type: { ext: 'pdf' },
    });
  });

  it('空文件与莫名字节不被当成任何格式', () => {
    expect(detectFileTypePartial(Buffer.alloc(0), null, 0)).toMatchObject({ ok: false, code: 'empty' });
    expect(detectFileTypePartial(Buffer.from('hello world'), null, 11)).toMatchObject({ ok: false });
  });
});
