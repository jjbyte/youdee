import { describe, expect, it } from 'vitest';
import { parseTemplateSheet, type RawCell, type RawSheet } from '@/domain/template-layout';

/** 造一张摊平后的表：cells 用 [行, 列, 文本] 描述，跨列单独给 */
function sheet(rows: Array<{ r: number; cells: Array<[number, string, number?]> }>, widths?: number[]): RawSheet {
  const cells: RawCell[] = [];
  let maxCol = 0;
  for (const row of rows) {
    for (const [c, text, span] of row.cells) {
      cells.push({
        row: row.r,
        col: c,
        text,
        colSpan: span ?? 1,
        bold: false,
        centered: false,
      });
      maxCol = Math.max(maxCol, c + (span ?? 1) - 1);
    }
  }
  return {
    cells,
    colWidths: widths ?? Array.from({ length: maxCol }, () => 12),
    maxCol,
  };
}

const HEADER_ROW = {
  r: 5,
  cells: [
    [1, '{{序号}}'],
    [2, '{{项目}}'],
    [3, '{{规格}}'],
    [4, '{{单位}}'],
    [5, '{{数量}}'],
    [6, '{{单价}}'],
    [7, '{{小计}}'],
    [8, '{{备注}}'],
  ] as Array<[number, string, number?]>,
};

function goodSheet(): RawSheet {
  return sheet(
    [
      { r: 1, cells: [[1, '{{公司名称}}', 8]] },
      { r: 2, cells: [[1, '{{项目名称}}活动报价', 8]] },
      { r: 3, cells: [[1, '报价单号：{{报价单号}}', 4], [5, '供应商名称：{{供应商名称}}', 4]] },
      { r: 4, cells: [[1, '客户名称：{{客户名称}}', 4], [5, '项目名称：{{项目名称}}', 4]] },
      HEADER_ROW,
    ],
    [7, 22, 16, 7, 7, 14, 15, 24],
  );
}

describe('template-layout — 正常解析', () => {
  it('列顺序、表头、列宽来自 Excel', () => {
    const { layout, issues } = parseTemplateSheet(goodSheet());
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(layout!.columns.map((c) => c.key)).toEqual([
      'no',
      'name',
      'spec',
      'unit',
      'qty',
      'unitPrice',
      'amount',
      'remark',
    ]);
    expect(layout!.columns.map((c) => c.width)).toEqual([7, 22, 16, 7, 7, 14, 15, 24]);
    expect(layout!.columns[1]!.header).toBe('项目');
  });

  it('前两行整宽单格识别成标题与副标题，其余是普通抬头行', () => {
    const { layout } = parseTemplateSheet(goodSheet());
    const kinds = layout!.meta.map((m) => m.kind);
    expect(kinds).toEqual(['title', 'subtitle', 'line', 'line']);
    expect(layout!.meta[0]!.cells[0]!.colSpan).toBe(2);
  });

  it('抬头一行的两格都保留，且各自占半宽', () => {
    const { layout } = parseTemplateSheet(goodSheet());
    expect(layout!.meta[2]!.cells.map((c) => c.text)).toEqual([
      '报价单号：{{报价单号}}',
      '供应商名称：{{供应商名称}}',
    ]);
    expect(layout!.meta[2]!.cells.every((c) => c.colSpan === 1)).toBe(true);
  });

  it('列顺序可以任意调整，只要占位符还在', () => {
    const swapped = sheet([
      {
        r: 1,
        cells: [
          [1, '{{序号}}'],
          [2, '{{备注}}'],
          [3, '{{项目}}'],
          [4, '{{数量}}'],
          [5, '{{小计}}'],
        ],
      },
    ]);
    const { layout } = parseTemplateSheet(swapped);
    expect(layout!.columns.map((c) => c.key)).toEqual(['no', 'remark', 'name', 'qty', 'amount']);
  });

  it('{{项目:服务项目}} 只改表头文案，列身份不变', () => {
    const renamed = sheet([
      {
        r: 1,
        cells: [
          [1, '{{项目:服务项目}}'],
          [2, '{{数量:场次}}'],
          [3, '{{小计}}'],
        ],
      },
    ]);
    const { layout } = parseTemplateSheet(renamed);
    expect(layout!.columns.map((c) => [c.key, c.header])).toEqual([
      ['name', '服务项目'],
      ['qty', '场次'],
      ['amount', '小计'],
    ]);
  });

  it('列宽异常时夹到合理区间，不因为没设列宽就把列压成 3 个字', () => {
    const narrow = sheet(
      [
        {
          r: 1,
          cells: [
            [1, '{{项目}}'],
            [2, '{{数量}}'],
            [3, '{{小计}}'],
          ],
        },
      ],
      [0, 200],
    );
    const { layout } = parseTemplateSheet(narrow);
    expect(layout!.columns.map((c) => c.width)).toEqual([12, 40, 12]);
  });
});

describe('template-layout — 必须拒绝的情况', () => {
  const errorsOf = (s: RawSheet) => parseTemplateSheet(s).issues.filter((i) => i.level === 'error');

  it('没有表头行（表头格不是占位符）时直接拒绝', () => {
    const bad = sheet([
      {
        r: 1,
        cells: [
          [1, '序号'],
          [2, '项目'],
          [3, '金额'],
        ],
      },
    ]);
    const { layout } = parseTemplateSheet(bad);
    expect(layout).toBeNull();
    expect(errorsOf(bad)[0]!.message).toContain('没找到明细表头');
  });

  it('缺「小计」列要拒绝：没有这一列，客户看不出钱是怎么算的', () => {
    const bad = sheet([
      {
        r: 1,
        cells: [
          [1, '{{项目}}'],
          [2, '{{数量}}'],
        ],
      },
    ]);
    expect(errorsOf(bad).some((i) => i.message.includes('缺少「小计」'))).toBe(true);
    expect(parseTemplateSheet(bad).layout).toBeNull();
  });

  it('未知的列占位符要报错，并说明可用列', () => {
    const bad = sheet([
      {
        r: 1,
        cells: [
          [1, '{{项目}}'],
          [2, '{{数量}}'],
          [3, '{{小计}}'],
          [4, '{{利润}}'],
        ],
      },
    ]);
    const err = errorsOf(bad);
    expect(err.some((i) => i.message.includes('不是可用的列'))).toBe(true);
    // 同时命中禁用词：利润不许出现在客户版
    expect(err.some((i) => i.message.includes('利润'))).toBe(true);
  });

  it('同一列出现两次要拒绝', () => {
    const bad = sheet([
      {
        r: 1,
        cells: [
          [1, '{{项目}}'],
          [2, '{{数量}}'],
          [3, '{{小计}}'],
          [4, '{{项目}}'],
        ],
      },
    ]);
    expect(errorsOf(bad).some((i) => i.message.includes('出现了两次'))).toBe(true);
  });

  it('抬头出现成本、毛利这类词直接拒绝（模板是新的注入面）', () => {
    const bad = sheet([
      { r: 1, cells: [[1, '成本合计：{{小计}}', 8]] },
      HEADER_ROW,
    ]);
    const err = errorsOf(bad);
    expect(err.some((i) => i.message.includes('成本'))).toBe(true);
    expect(parseTemplateSheet(bad).layout).toBeNull();
  });

  it('抬头占位符不在白名单里要拒绝，不静默忽略', () => {
    const bad = sheet([
      { r: 1, cells: [[1, '客户地址：{{客户地址}}', 8]] },
      HEADER_ROW,
    ]);
    const err = errorsOf(bad);
    expect(err.some((i) => i.message.includes('{{客户地址}}'))).toBe(true);
    expect(err[0]!.message).toContain('可用的抬头字段');
  });

  it('抬头一行超过两个格子要拒绝：纸上只有两栏，三格一定错位', () => {
    const bad = sheet([
      { r: 1, cells: [[1, 'A'], [2, 'B'], [3, 'C']] },
      HEADER_ROW,
    ]);
    expect(errorsOf(bad).some((i) => i.message.includes('最多两个'))).toBe(true);
  });

  it('第 9 列只能是重复列或未知列，两种都要拒绝（8 列是 A4 纵向的上限）', () => {
    const many = sheet([
      {
        r: 1,
        cells: [
          [1, '{{序号}}'],
          [2, '{{项目}}'],
          [3, '{{规格}}'],
          [4, '{{单位}}'],
          [5, '{{数量}}'],
          [6, '{{单价}}'],
          [7, '{{小计}}'],
          [8, '{{备注}}'],
          [9, '{{项目:副标题}}'],
        ],
      },
    ]);
    const err = errorsOf(many);
    expect(err.some((i) => i.message.includes('出现了两次'))).toBe(true);
    expect(parseTemplateSheet(many).layout).toBeNull();
  });

  it('有错误时不返回 layout，哪怕其余部分都对', () => {
    const bad = sheet([
      { r: 1, cells: [[1, '{{客户名称}}', 8]] },
      { r: 2, cells: [[1, '成本：1']] },
      HEADER_ROW,
    ]);
    expect(parseTemplateSheet(bad).layout).toBeNull();
  });
});

describe('template-layout — 只提醒不拦截', () => {
  it('抬头为空只给警告：出单只有表格，但不是不能用', () => {
    const { layout, issues } = parseTemplateSheet(sheet([HEADER_ROW]));
    expect(layout).not.toBeNull();
    expect(issues.some((i) => i.level === 'warn' && i.message.includes('抬头区是空的'))).toBe(true);
  });

  it('表头里混了固定文字的格子被忽略并提示，不当作列', () => {
    const { layout, issues } = parseTemplateSheet(
      sheet([
        {
          r: 1,
          cells: [
            [1, '{{项目}}'],
            [2, '{{数量}}'],
            [3, '{{小计}}'],
            [4, '合计'],
          ],
        },
      ]),
    );
    expect(layout!.columns).toHaveLength(3);
    expect(issues.some((i) => i.level === 'warn' && i.message.includes('不是占位符'))).toBe(true);
  });
});
