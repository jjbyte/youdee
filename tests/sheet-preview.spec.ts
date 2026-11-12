import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CELL_MAX_CHARS, toSheetPreview } from '@/server/services/sheet-preview';

/** 造一个最小工作簿：rows 是二维值，null 表示留空 */
function makeBook(sheets: { name: string; rows: (string | number | null)[][] }[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === null) return;
        ws.getCell(r + 1, c + 1).value = v;
      });
    });
  }
  return wb;
}

describe('toSheetPreview', () => {
  it('按行取到值，并补齐到相同列数', () => {
    const wb = makeBook([
      {
        name: '报价',
        rows: [
          ['名称', '数量', '单价'],
          ['桁架', 2, 300],
          ['音响', 1, null],
        ],
      },
    ]);
    const [sheet] = toSheetPreview(wb);
    expect(sheet!.name).toBe('报价');
    expect(sheet!.rows[0]).toEqual(['名称', '数量', '单价']);
    expect(sheet!.rows[1]).toEqual(['桁架', '2', '300']);
    // 第三行第 3 格没值，也要占位，否则前端表格会错列
    expect(sheet!.rows[2]).toEqual(['音响', '1', '']);
    expect(sheet!.truncated).toBe(false);
  });

  it('行数超上限时截断并标记 truncated，totalRows 仍是真实值', () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`第${i + 1}行`]);
    const wb = makeBook([{ name: '长表', rows }]);
    const [sheet] = toSheetPreview(wb, { maxRows: 5 });
    expect(sheet!.rows).toHaveLength(5);
    expect(sheet!.totalRows).toBe(12);
    expect(sheet!.truncated).toBe(true);
  });

  it('列数超上限时截断并标记 truncated', () => {
    const wb = makeBook([{ name: '宽表', rows: [['a', 'b', 'c', 'd', 'e']] }]);
    const [sheet] = toSheetPreview(wb, { maxCols: 3 });
    expect(sheet!.rows[0]).toEqual(['a', 'b', 'c']);
    expect(sheet!.totalCols).toBe(5);
    expect(sheet!.truncated).toBe(true);
  });

  it('整行全空的丢掉：Excel 末尾常有一堆被格式化过的空行', () => {
    const wb = makeBook([
      {
        name: '空行',
        rows: [['有值'], [null], ['下一行']],
      },
    ]);
    const [sheet] = toSheetPreview(wb);
    expect(sheet!.rows.map((r) => r[0])).toEqual(['有值', '下一行']);
  });

  it('超长单元格被截断，不让一格备注把表格撑爆', () => {
    const long = 'x'.repeat(CELL_MAX_CHARS + 50);
    const wb = makeBook([{ name: '长文本', rows: [[long]] }]);
    const [sheet] = toSheetPreview(wb);
    const cell = sheet!.rows[0]![0]!;
    expect(cell).toHaveLength(CELL_MAX_CHARS + 1); // 末尾是省略号
    expect(cell.endsWith('…')).toBe(true);
  });

  it('工作表超上限时只取前几份', () => {
    const wb = makeBook([
      { name: 'S1', rows: [['a']] },
      { name: 'S2', rows: [['b']] },
      { name: 'S3', rows: [['c']] },
    ]);
    const sheets = toSheetPreview(wb, { maxSheets: 2 });
    expect(sheets.map((s) => s.name)).toEqual(['S1', 'S2']);
  });

  it('公式取结果值，不是公式文本', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('公式');
    ws.getCell('A1').value = 100;
    ws.getCell('A2').value = { formula: 'A1*2', result: 200 };
    const [sheet] = toSheetPreview(wb);
    expect(sheet!.rows[1]![0]).toBe('200');
  });
});
