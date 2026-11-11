import { describe, it, expect } from 'vitest';
import {
  SHEET_OPTIONS_DEFAULT,
  buildCustomerSheet,
  sheetColumns,
  sheetTaxLine,
  type SheetQuoteInput,
} from '../src/domain/customer-sheet';

const quote = (over: Partial<SheetQuoteInput> = {}): SheetQuoteInput => ({
  quoteNo: 'YD-2614',
  version: 1,
  customerName: '星海科技',
  eventName: '2026 年会',
  eventDate: '2026-12-20',
  validUntil: '2026-12-05',
  taxStatement: 'inclusive',
  discountAmount: '0',
  totalPrice: '12846.00',
  note: null,
  supplierName: '杭州星芒活动策划',
  quoteDate: '2026-11-06',
  items: [
    { name: '桁架背景板', spec: '3m×6m', unit: '㎡', qty: '18', unitPrice: '296.30', amount: '5333.40', category: '舞美硬体' },
    { name: 'LED 屏', spec: 'P2.5', unit: '㎡', qty: '12', unitPrice: '433.33', amount: '5200.00', category: '灯光音响AV' },
    { name: '搭建工', spec: null, unit: '人天', qty: '4', unitPrice: '578.15', amount: '2312.60', category: '舞美硬体' },
  ],
  ...over,
});

const company = { name: '杭州星芒活动策划', address: '杭州市西湖区', phone: '0571-88888888' };

describe('customer-sheet — 打印与 Excel 的同一份版面', () => {
  it('详细档列 = 序号/项目/规格/单位/数量/单价/小计/备注（备注在最后一列）', () => {
    expect(sheetColumns(SHEET_OPTIONS_DEFAULT).map((c) => c.header)).toEqual([
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

  it('备注紧跟在小计后面，是整张表的最后一列', () => {
    const keys = sheetColumns(SHEET_OPTIONS_DEFAULT).map((c) => c.key);
    expect(keys[keys.length - 1]).toBe('remark');
    expect(keys.indexOf('remark')).toBe(keys.indexOf('amount') + 1);
  });

  it('只有文字列允许折行，金额列必须单行', () => {
    const cols = sheetColumns(SHEET_OPTIONS_DEFAULT);
    const wrapped = cols.filter((c) => c.wrap).map((c) => c.key);
    expect(wrapped).toEqual(['name', 'spec', 'remark']);
    // 数字列折行会让「1,234.00」断在逗号处，客户会按两笔读
    expect(cols.filter((c) => c.money).every((c) => !c.wrap)).toBe(true);
  });

  it('精简档去掉规格与备注两列，关掉单价再少一列', () => {
    expect(sheetColumns({ ...SHEET_OPTIONS_DEFAULT, layout: 'brief' }).map((c) => c.key)).toEqual([
      'no',
      'name',
      'unit',
      'qty',
      'unitPrice',
      'amount',
    ]);
    expect(
      sheetColumns({ ...SHEET_OPTIONS_DEFAULT, showUnitPrice: false }).map((c) => c.key),
    ).toEqual(['no', 'name', 'spec', 'unit', 'qty', 'amount', 'remark']);
  });

  it('分组按出现顺序编号，序号跨组连续', () => {
    const s = buildCustomerSheet(quote(), company);
    expect(s.groups.map((g) => g.title)).toEqual(['一、舞美硬体', '二、灯光音响AV']);
    expect(s.groups[0]!.rows.map((r) => r.no)).toEqual([1, 2]);
    expect(s.groups[1]!.rows.map((r) => r.no)).toEqual([3]);
  });

  it('不分组时只有一组，标题为空，序号仍连续', () => {
    const s = buildCustomerSheet(quote(), company, { ...SHEET_OPTIONS_DEFAULT, grouped: false });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]!.title).toBeNull();
    expect(s.groups[0]!.rows.map((r) => r.no)).toEqual([1, 2, 3]);
  });

  it('抬头四行与 Excel 的合并单元格一一对应', () => {
    const s = buildCustomerSheet(quote(), company);
    expect(s.metaRows.map((r) => r.map((c) => c.text))).toEqual([
      ['报价单号：YD-2614  V1', '供应商名称：杭州星芒活动策划'],
      ['客户名称：星海科技', '项目名称：2026 年会'],
      ['报价日期：2026-11-06', '活动日期：2026-12-20'],
      ['报价有效期：2026-12-05', '税口径：含税'],
    ]);
  });

  it('供应商名称缺失时印破折号，不留一格空白（空白看着像漏印）', () => {
    const s = buildCustomerSheet(quote({ supplierName: '  ' }), company);
    expect(s.metaRows[0]?.[1]?.text).toBe('供应商名称：—');
  });

  it('缺活动日期时只有右格空着，税口径不会被挤到左边单独飘一行', () => {
    const s = buildCustomerSheet(quote({ eventDate: null, quoteDate: null }), company);
    expect(s.metaRows[2]?.map((c) => c.text)).toEqual(['', '']);
    expect(s.metaRows[3]?.map((c) => c.text)).toEqual(['报价有效期：2026-12-05', '税口径：含税']);
  });

  it('优惠为 0 时不出现优惠行；关掉折扣连合计文案一起变', () => {
    expect(buildCustomerSheet(quote(), company).discount).toBeNull();
    const withDiscount = buildCustomerSheet(quote({ discountAmount: '500.00' }), company);
    expect(withDiscount.discount).toEqual({ label: '整单优惠', amount: '500.00' });
    expect(withDiscount.totalLabel).toBe('报价合计');

    const off = buildCustomerSheet(quote({ discountAmount: '500.00' }), company, {
      ...SHEET_OPTIONS_DEFAULT,
      showDiscount: false,
    });
    expect(off.discount).toBeNull();
    expect(off.totalLabel).toBe('合计');
  });

  it('关掉折扣时合计回到折前金额，否则客户按行加总对不上', () => {
    // 行小计和 = 5333.40 + 5200.00 + 2312.60 = 12846.00；折后 12346.00
    const q = quote({ discountAmount: '500.00', totalPrice: '12346.00' });
    expect(buildCustomerSheet(q, company).totalAmount).toBe('12346.00');
    expect(
      buildCustomerSheet(q, company, { ...SHEET_OPTIONS_DEFAULT, showDiscount: false }).totalAmount,
    ).toBe('12846.00');
  });

  it('详细档里备注是独立一列，项目名不再驮括号', () => {
    const q = quote({ items: [{ ...quote().items[0]!, remark: '含安装' }] });
    const row = buildCustomerSheet(q, company).groups[0]!.rows[0]!;
    expect(row.name).toBe('桁架背景板');
    expect(row.spec).toBe('3m×6m');
    expect(row.remark).toBe('含安装');
  });

  it('精简档没有备注列，备注折进项目名——省列不能把信息一起省掉', () => {
    const q = quote({ items: [{ ...quote().items[0]!, remark: '含安装' }] });
    const row = buildCustomerSheet(q, company, { ...SHEET_OPTIONS_DEFAULT, layout: 'brief' }).groups[0]!
      .rows[0]!;
    expect(row.name).toBe('桁架背景板（含安装）');
    expect(row.remark).toBe('');
  });

  it('备注只有空白时不占位，也不留一对空括号', () => {
    const q = quote({ items: [{ ...quote().items[0]!, remark: '   ' }] });
    const s = buildCustomerSheet(q, company);
    expect(s.groups[0]!.rows[0]!.remark).toBe('');
    expect(s.groups[0]!.rows[0]!.name).toBe('桁架背景板');
    expect(
      buildCustomerSheet(q, company, { ...SHEET_OPTIONS_DEFAULT, layout: 'brief' }).groups[0]!.rows[0]!
        .name,
    ).toBe('桁架背景板');
  });

  it('缺规格给破折号，不空白', () => {
    const s = buildCustomerSheet(quote(), company);
    expect(s.groups[0]!.rows[1]!.spec).toBe('—');
  });

  it('页脚带口径声明与公司联系方式', () => {
    const s = buildCustomerSheet(quote(), company);
    expect(s.taxLine).toBe(sheetTaxLine('inclusive'));
    expect(s.footer[0]).toBe('杭州星芒活动策划');
    expect(s.footer[1]).toContain('0571-88888888');
  });

  it('没配公司名时标题兜底，不是空白纸', () => {
    expect(buildCustomerSheet(quote(), {}).title).toBe('报价单');
  });
});

describe('customer-sheet — 报价人（操作人员）在抬头', () => {
  const texts = (s: ReturnType<typeof buildCustomerSheet>) => s.metaRows.map((r) => r.map((c) => c.text));

  it('有姓名与电话时，抬头多一行「报价人 / 联系电话」', () => {
    const s = buildCustomerSheet(quote({ operatorName: '王小明', operatorPhone: '0571-8888 6677' }), company);
    expect(s.metaRows).toHaveLength(5);
    expect(texts(s)[4]).toEqual(['报价人：王小明', '联系电话：0571-8888 6677']);
  });

  it('只有姓名（账号没填电话）时，右格留空而不是写半个「联系电话：」', () => {
    const s = buildCustomerSheet(quote({ operatorName: '王小明', operatorPhone: null }), company);
    expect(texts(s)[4]).toEqual(['报价人：王小明', '']);
  });

  it('创建人已删、电话也没有时整行不出现，不留一个空抬头', () => {
    const s = buildCustomerSheet(quote({ operatorName: null, operatorPhone: null }), company);
    expect(s.metaRows).toHaveLength(4);
  });

  it('空白字符串按没填处理（老数据里是空格不是 null）', () => {
    const s = buildCustomerSheet(quote({ operatorName: '  ', operatorPhone: '  ' }), company);
    expect(s.metaRows).toHaveLength(4);
  });
});
