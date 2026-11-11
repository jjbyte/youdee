import { describe, expect, it } from 'vitest';
import { buildSampleWorkbook, readTemplateSheet } from '@/server/services/template-file.service';
import { parseTemplateSheet } from '@/domain/template-layout';
import { SHEET_OPTIONS_DEFAULT, buildCustomerSheet } from '@/domain/customer-sheet';

/**
 * 样例模板 → 读回 → 解析 → 渲染，整条链路走一遍。
 *
 * 这是这次改动最关键的闭环：管理员下载的样例必须能被自己的解析器吃下去，
 * 而且解析出来的版式要能渲染成一张纸。样例一旦和解析器对不上，
 * 管理员第一次上传就会失败，功能等于没有。
 */
describe('样例模板能原样读回并解析', () => {
  it('解析出 8 列，顺序与默认版式一致', async () => {
    const buf = await buildSampleWorkbook();
    const raw = await readTemplateSheet(buf);
    const { layout, issues } = parseTemplateSheet(raw);

    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(layout).not.toBeNull();
    expect(layout!.columns.map((c) => c.header)).toEqual([
      '序号',
      '项目',
      '规格',
      '单位',
      '数量',
      '单价',
      '小计',
      '备注',
    ]);
  });

  it('抬头识别出标题、副标题与 5 组两栏抬头', async () => {
    const raw = await readTemplateSheet(await buildSampleWorkbook());
    const { layout } = parseTemplateSheet(raw);
    expect(layout!.meta[0]!.kind).toBe('title');
    expect(layout!.meta[1]!.kind).toBe('subtitle');
    expect(layout!.meta.filter((m) => m.kind === 'line')).toHaveLength(5);
  });

  it('用这份版式渲染出来的纸面与原默认版式的列序、抬头一致', async () => {
    const raw = await readTemplateSheet(await buildSampleWorkbook());
    const { layout } = parseTemplateSheet(raw);

    const quote = {
      quoteNo: 'YD-2620',
      version: 1,
      customerName: '星海科技',
      eventName: '2026 年会',
      eventDate: '2026-12-20',
      validUntil: '2026-12-05',
      taxStatement: 'inclusive' as const,
      discountAmount: '0',
      totalPrice: '12846.00',
      supplierName: '杭州星芒活动策划',
      quoteDate: '2026-11-11',
      operatorName: '王小明',
      operatorPhone: '0571-8888 6677',
      items: [
        {
          name: '桁架',
          spec: '1.2m×2.4m',
          unit: '米',
          qty: '18',
          unitPrice: '120.00',
          amount: '2160.00',
          remark: '含运输',
          category: '舞美硬体',
        },
      ],
    };
    const company = { name: '杭州星芒活动策划', address: '杭州', phone: '0571-8888 0000' };

    const withLayout = buildCustomerSheet(quote, company, undefined, layout);
    const withoutLayout = buildCustomerSheet(quote, company);

    expect(withLayout.columns.map((c) => c.key)).toEqual(withoutLayout.columns.map((c) => c.key));
    expect(withLayout.metaRows.map((r) => r.map((c) => c.text))).toEqual(
      withoutLayout.metaRows.map((r) => r.map((c) => c.text)),
    );
    expect(withLayout.title).toBe(withoutLayout.title);
  });
});

describe('自定义版式：模板定列，渲染跟着走', () => {
  const quote = {
    quoteNo: 'YD-2621',
    version: 2,
    customerName: '星海科技',
    eventName: '2026 年会',
    eventDate: '2026-12-20',
    validUntil: '2026-12-05',
    taxStatement: 'inclusive' as const,
    discountAmount: '0',
    totalPrice: '2160.00',
    supplierName: '杭州星芒活动策划',
    quoteDate: '2026-11-11',
    operatorName: '王小明',
    operatorPhone: null,
    items: [
      {
        name: '桁架',
        spec: '1.2m×2.4m',
        unit: '米',
        qty: '18',
        unitPrice: '120.00',
        amount: '2160.00',
        remark: '含运输',
        category: '舞美硬体',
      },
    ],
  };
  const company = { name: '杭州星芒活动策划' };

  /** 四列，去掉了规格、单价、备注，项目也改了名 */
  const layout = {
    version: 1 as const,
    columns: [
      { key: 'no' as const, header: '序号', width: 7 },
      { key: 'name' as const, header: '服务项目', width: 30 },
      { key: 'qty' as const, header: '场次', width: 8 },
      { key: 'amount' as const, header: '金额', width: 15 },
    ],
    meta: [
      { kind: 'title' as const, cells: [{ text: '{{客户名称}}', colSpan: 2 as const, align: 'center' as const, bold: true }] },
      {
        kind: 'line' as const,
        cells: [
          { text: '单号 {{报价单号}}', colSpan: 1 as const, align: 'left' as const, bold: false },
          { text: '{{供应商名称}}', colSpan: 1 as const, align: 'right' as const, bold: false },
        ],
      },
    ],
  };

  it('列序、表头文案、列宽都听模板的', () => {
    const s = buildCustomerSheet(quote, company, undefined, layout);
    expect(s.columns.map((c) => c.key)).toEqual(['no', 'name', 'qty', 'amount']);
    expect(s.columns.map((c) => c.header)).toEqual(['序号', '服务项目', '场次', '金额']);
    expect(s.columns.map((c) => c.width)).toEqual([7, 30, 8, 15]);
  });

  it('没有备注列时，行备注折进项目名（省列不能把信息一起省掉）', () => {
    const s = buildCustomerSheet(quote, company, undefined, layout);
    expect(s.groups[0]!.rows[0]!.name).toBe('桁架（含运输）');
    expect(s.groups[0]!.rows[0]!.remark).toBe('');
  });

  it('没有单价列时不渲染单价，界面上勾了也不冒出来', () => {
    const s = buildCustomerSheet(quote, company, { ...SHEET_OPTIONS_DEFAULT, showUnitPrice: true }, layout);
    expect(s.columns.some((c) => c.key === 'unitPrice')).toBe(false);
    expect(s.groups[0]!.rows[0]!.unitPrice).toBeNull();
  });

  it('标题取模板里的占位符，副标题没写就不印', () => {
    const s = buildCustomerSheet(quote, company, undefined, layout);
    expect(s.title).toBe('星海科技');
    expect(s.subtitle).toBe('');
  });

  it('抬头按模板排布，右格带自己的对齐', () => {
    const s = buildCustomerSheet(quote, company, undefined, layout);
    expect(s.metaRows).toHaveLength(1);
    expect(s.metaRows[0]!.map((c) => c.text)).toEqual(['单号 YD-2621', '杭州星芒活动策划']);
    expect(s.metaRows[0]![1]!.align).toBe('right');
  });

  it('模板里没写报价人，这一行就整行不出（不印半截「报价人：」）', () => {
    const s = buildCustomerSheet(quote, company, undefined, layout);
    expect(s.metaRows.some((r) => r.some((c) => c.text.includes('报价人')))).toBe(false);
  });
});
