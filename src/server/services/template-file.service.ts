/**
 * 模板 Excel 的读写：管理员上传的 xlsx → `RawSheet`，以及「样例模板」的生成。
 *
 * 两层分工：
 *   - 这里只负责把 Excel 摊平成单元格网格（谁在第几行第几列、跨几列、多宽），
 *   - 判断「这个版式能不能用」全部交给 `domain/template-layout.ts`（纯函数，可单测）。
 *
 * 上传前先做 zip 体检：xlsx 本质是 zip，5MB 的文件可以解出几个 G，
 * 直接丢给 ExcelJS 会把服务进程撑死。所以先读中央目录算解压后总量，再决定要不要读内容。
 */
import ExcelJS from 'exceljs';
import { AppError } from '../http';
import type { RawCell, RawSheet } from '@/domain/template-layout';

/** 解压后允许的上限。正常报价单模板不到 200KB，1MB 已经很宽松 */
const MAX_UNZIPPED = 50 * 1024 * 1024;

interface ZipEntry {
  name: string;
  uncompressed: number;
}

/**
 * 只读 zip 的中央目录：拿到每个条目的文件名与解压后大小，不做解压。
 *
 * 够用即可——我们不指望它是完整的 zip 解析器，只需要三件事：
 * 是不是真的 zip、有没有宏、解压后会不会炸。
 */
export function inspectZip(buf: Buffer): ZipEntry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // EOCD 固定 22 字节，注释最多 65535，从尾部往前找
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError(41501, '这个文件不是有效的 xlsx（读不到压缩目录）。', 415, { field: 'file' });

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const uncompressed = buf.readUInt32LE(off + 24);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, uncompressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * 上传前的体检。返回错误而不是抛异常的地方只有一处：
 * `.xlsm` 是明确要拒的（带宏），其余交给调用方统一转成 4xx。
 */
export function assertXlsx(buf: Buffer): void {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new AppError(41501, '只支持 .xlsx 文件。老的 .xls 请先用 Excel 另存为 .xlsx。', 415, { field: 'file' });
  }
  let entries: ZipEntry[];
  try {
    entries = inspectZip(buf);
  } catch {
    throw new AppError(41501, '这个文件不是有效的 xlsx（压缩包结构损坏）。', 415, { field: 'file' });
  }
  const names = new Set(entries.map((e) => e.name));
  if (names.has('xl/vbaProject.bin')) {
    throw new AppError(41501, '这个文件带宏（.xlsm）。请另存为普通 .xlsx 再上传——服务端不会执行宏。', 415, {
      field: 'file',
    });
  }
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
    throw new AppError(41501, '这个压缩包不是 Excel 工作簿（缺少 workbook.xml）。', 415, { field: 'file' });
  }
  const total = entries.reduce((a, e) => a + e.uncompressed, 0);
  if (total > MAX_UNZIPPED) {
    throw new AppError(41301, `这个文件解开后超过 ${Math.round(MAX_UNZIPPED / 1024 / 1024)}MB，不接收。`, 413, {
      field: 'file',
    });
  }
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const any = v as { richText?: Array<{ text: string }>; text?: string; result?: unknown; formula?: string };
    if (Array.isArray(any.richText)) return any.richText.map((t) => t.text).join('').trim();
    if (typeof any.text === 'string') return any.text.trim();
    // 公式只取缓存结果，不求值：不执行任何外部引用
    if (any.result !== undefined && any.result !== null) return cellText(any.result as ExcelJS.CellValue);
  }
  return '';
}

function parseRange(ref: string): { top: number; left: number; bottom: number; right: number } | null {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref.replace(/\$/g, ''));
  if (!m) return null;
  const col = (s: string) => Array.from(s).reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
  const left = col(m[1]!);
  const top = Number(m[2]);
  const right = m[3] ? col(m[3]) : left;
  const bottom = m[4] ? Number(m[4]) : top;
  return { top, left, bottom, right };
}

/** 把工作簿的第一张表摊平成网格。只看第一张：说明页放第二张 */
export async function readTemplateSheet(buf: Buffer): Promise<RawSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError(41501, '这个 xlsx 打不开，可能已损坏。用 Excel 打开后另存一份再传。', 415, { field: 'file' });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError(40001, '这个文件里没有工作表。', 400, { field: 'file' });

  const merges = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [])
    .map(parseRange)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  /** 合并区左上角 → 跨几列 */
  const spanAt = new Map<string, number>();
  /** 合并区里非左上角的格子：没有值，跳过 */
  const covered = new Set<string>();
  for (const m of merges) {
    spanAt.set(`${m.top},${m.left}`, m.right - m.left + 1);
    for (let r = m.top; r <= m.bottom; r += 1) {
      for (let c = m.left; c <= m.right; c += 1) {
        if (r === m.top && c === m.left) continue;
        covered.add(`${r},${c}`);
      }
    }
  }

  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  /**
   * 有的表被整列刷过格式，rowCount 会报到几千行。模板只需要十几行，
   * 超出的部分一定是空的或误建的内容，直接拒掉比默默扫一遍强。
   */
  if (rowCount > 500 || colCount > 60) {
    throw new AppError(
      40001,
      `这张表有 ${rowCount} 行 ${colCount} 列，超出模板的范围（500 行 / 60 列）。把不需要的行列删掉再传。`,
      400,
      { field: 'file' },
    );
  }
  const cells: RawCell[] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c += 1) {
      if (covered.has(`${r},${c}`)) continue;
      const cell = row.getCell(c);
      const text = cellText(cell.value);
      if (!text) continue;
      cells.push({
        row: r,
        col: c,
        text,
        colSpan: spanAt.get(`${r},${c}`) ?? 1,
        bold: cell.font?.bold === true,
        centered: cell.alignment?.horizontal === 'center',
      });
    }
  }

  const colWidths: number[] = [];
  for (let c = 1; c <= colCount; c += 1) {
    colWidths.push(ws.getColumn(c).width ?? 8.43);
  }

  return { cells, colWidths, maxCol: colCount };
}

const THIN = { style: 'thin' as const, color: { argb: 'FFD0D5DD' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * 样例模板：管理员下载后直接在 Excel 里改，占位符不动。
 *
 * 样例本身就是「默认版式」的可视化版本——列序、列宽、抬头行都与系统默认一致，
 * 这样第一次上传不改任何东西，出单效果也应当与改造前一样（可作为回归基准）。
 */
export async function buildSampleWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '有得报价';
  const ws = wb.addWorksheet('报价单');

  const widths = [7, 22, 16, 7, 7, 14, 15, 24];
  ws.columns = widths.map((w) => ({ width: w }));

  const metaRows: Array<[string, string]> = [
    ['报价单号：{{报价单号}}  {{版本}}', '供应商名称：{{供应商名称}}'],
    ['客户名称：{{客户名称}}', '项目名称：{{项目名称}}'],
    ['报价日期：{{报价日期}}', '活动日期：{{活动日期}}'],
    ['报价有效期：{{报价有效期}}', '税口径：{{税口径}}'],
    ['报价人：{{报价人}}', '联系电话：{{联系电话}}'],
  ];

  const title = ws.addRow(['{{公司名称}}']);
  title.font = { bold: true, size: 16 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(title.number, 1, title.number, 8);

  const sub = ws.addRow(['{{项目名称}}活动报价 · 单号 {{报价单号}} {{版本}}']);
  sub.font = { size: 10, color: { argb: 'FF667085' } };
  sub.alignment = { horizontal: 'center' };
  ws.mergeCells(sub.number, 1, sub.number, 8);

  const splitAt = 4;
  for (const [left, right] of metaRows) {
    const r = ws.addRow([left, '', '', '', right]);
    ws.mergeCells(r.number, 1, r.number, splitAt);
    ws.mergeCells(r.number, splitAt + 1, r.number, 8);
  }
  ws.addRow([]);

  const header = ws.addRow([
    '{{序号}}',
    '{{项目}}',
    '{{规格}}',
    '{{单位}}',
    '{{数量}}',
    '{{单价}}',
    '{{小计}}',
    '{{备注}}',
  ]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const hint = ws.addRow([
    '这一行只是示例数据，上传时会忽略。',
    '在这里加行、删行、改顺序都可以，只要是 {{占位符}} 就认。',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  hint.font = { size: 9, color: { argb: 'FF98A2B3' } };
  ws.mergeCells(hint.number, 2, hint.number, 8);

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.47, right: 0.47, top: 0.55, bottom: 0.55, header: 0.3, footer: 0.3 },
  };

  // ── 第二张：填写说明。解析只看第一张，这张不会被当成版式 ──
  const help = wb.addWorksheet('填写说明');
  help.columns = [{ width: 26 }, { width: 92 }];
  const lines: Array<[string, string]> = [
    ['这份文件是什么', '上传后决定客户版报价单长什么样：有哪些列、什么顺序、表头写什么、抬头怎么排。'],
    ['怎么改', '直接在「报价单」这张表里改。调列顺序 = 左右挪动表头；改表头文字 = 改单元格里的字。'],
    ['不要删的东西', '{{ }} 里的字是占位符，上传时会被替换成单据里的真实内容。删掉就印不出来了。'],
    ['列', '{{序号}} {{项目}} {{规格}} {{单位}} {{数量}} {{单价}} {{小计}} {{备注}}'],
    ['改列名', '写成 {{项目:服务项目}}，表头就印「服务项目」，这一列仍然是「项目」的数据。'],
    ['必含的列', '项目、数量、小计。缺一个这张表就算不平，上传会被拒绝。'],
    ['最多几列', '8 列。A4 纵向再多就装不下了。'],
    ['抬头可以用', '{{报价单号}} {{版本}} {{供应商名称}} {{客户名称}} {{项目名称}} {{报价日期}} {{活动日期}} {{报价有效期}} {{税口径}} {{报价人}} {{联系电话}} {{公司名称}} {{公司地址}} {{公司电话}}'],
    ['抬头的排布', '一行可以放一个字段（占满整宽），也可以放两个（左右各一）。第一行和第二部分别当作标题与副标题。'],
    ['不能出现的词', '成本、毛利、加价、利润、最低价这类内部口径。客户版不允许出现，命中会直接拒绝上传。'],
    ['不会被还原', '图片、图表、条件格式、多行表头、单元格里的公式。字体、边框、底色、列宽、合并会保留。'],
    ['改完怎么生效', '上传并启用后，只影响之后新建的报价单。已经建好的单仍然按建单那一刻的版式打印。'],
  ];
  help.addRow(['项目', '说明']).font = { bold: true };
  for (const [k, v] of lines) {
    const r = help.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.alignment = { vertical: 'top', wrapText: true };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
