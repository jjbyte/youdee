/**
 * Excel 附件的在线预览：把工作簿解析成"表格的二维字符串"，交给前端画。
 *
 * 为什么在服务端解析、而不是把 xlsx 丢给浏览器用 SheetJS：
 *   1. 项目里已经有 exceljs（导出报价单在用），不必为了预览再引一个解析库；
 *   2. 解析不受信任的 zip 容器是有风险的（压缩炸弹、原型污染），
 *      放在进程里跑至少还能被超时和内存上限兜住，放进浏览器就是用户的机器在扛；
 *   3. 前端拿到的只有几十 KB 的 JSON，比把 20MB 的 xlsx 灌进弹层快得多。
 *
 * 代价是**丢格式**：合并单元格、颜色、列宽、图表都不还原，只有值和行列位置。
 * 对"核对金额和条款"这个目的够用；要看原样请下载。
 */
import ExcelJS from 'exceljs';

/** 单表最多画这么多行/列。报价单常见几百行，再多就不是"看一眼"的场景了 */
export const SHEET_MAX_ROWS = 300;
export const SHEET_MAX_COLS = 60;
/** 最多几个工作表。附件里塞十几个 sheet 的情况存在，但不该让弹层卡住 */
export const SHEET_MAX_SHEETS = 8;
/** 单个单元格最多这么多字符：一格里塞几千字的备注会把表格撑爆 */
export const CELL_MAX_CHARS = 300;

export interface SheetPreview {
  name: string;
  /** 二维字符串，已按行补齐到相同列数（前端不用再判空洞） */
  rows: string[][];
  /** 实际有多少行/列（可能是被截断前的真实值） */
  totalRows: number;
  totalCols: number;
  /** 行或列被切掉了 */
  truncated: boolean;
}

function cellText(cell: ExcelJS.Cell): string {
  // cell.text 是 exceljs 给的"给人看的值"：日期按格式、公式取结果、富文本拼串。
  // 自己读 cell.value 要处理十几种形态，漏一种就是弹层里出现 [object Object]。
  const raw = cell.text ?? '';
  const s = String(raw).replace(/\r\n?/g, '\n');
  return s.length > CELL_MAX_CHARS ? `${s.slice(0, CELL_MAX_CHARS)}…` : s;
}

/** 纯函数：Workbook → 预览数据。单独抽出来是为了能直接用内存里造的工作簿做单测 */
export function toSheetPreview(
  wb: ExcelJS.Workbook,
  opts: { maxRows?: number; maxCols?: number; maxSheets?: number } = {},
): SheetPreview[] {
  const maxRows = opts.maxRows ?? SHEET_MAX_ROWS;
  const maxCols = opts.maxCols ?? SHEET_MAX_COLS;
  const maxSheets = opts.maxSheets ?? SHEET_MAX_SHEETS;

  const out: SheetPreview[] = [];
  wb.eachSheet((ws) => {
    if (out.length >= maxSheets) return;

    // rowCount/columnCount 是"用过的范围"，包含只有样式没有值的格子。
    // 扫描件表格经常整列空着样式，直接用会把 totalCols 报成 16384。
    const totalRows = ws.rowCount;
    const totalCols = ws.columnCount;

    const lastRow = Math.min(totalRows, maxRows);
    const lastCol = Math.min(totalCols, maxCols);
    const rows: string[][] = [];
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= lastCol; c++) {
        cells.push(cellText(row.getCell(c)));
      }
      // 整行全空就丢：Excel 末尾常有一堆"看起来空、其实被格式化过"的行
      if (cells.some((v) => v !== '')) rows.push(cells);
    }

    out.push({
      name: ws.name,
      rows,
      totalRows,
      totalCols,
      truncated: totalRows > maxRows || totalCols > maxCols,
    });
  });

  return out;
}

/** 解析一份 xlsx（xls 老格式解析不了，调用方要先挡住） */
export async function previewWorkbook(buf: Buffer): Promise<SheetPreview[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 自带的类型声明把 load 的入参写成了它自己那份旧 NodeJS.Buffer，
  // 和当前 @types/node 的 Buffer 不是同一个接口，直接传会报"缺少 resizable"。
  // 只在这一处转一次类型，别为了它把整个项目的 Buffer 定义降级。
  await wb.xlsx.load(buf as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  return toSheetPreview(wb);
}
