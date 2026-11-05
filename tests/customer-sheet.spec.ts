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
  items: [
    { name: '桁架背景板', spec: '3m×6m', unit: '㎡', qty: '18', unitPrice: '296.30', amount: '5333.40', category: '舞美硬体' },
    { name: 'LED 屏', spec: 'P2.5', unit: '㎡', qty: '12', unitPrice: '433.33', amount: '5200.00', category: '灯光音响AV' },
    { name: '搭建工', spec: null, unit: '人天', qty: '4', unitPrice: '578.15', amount: '2312.60', category: '舞美硬体' },
  ],
  ...over,
});

const company = { name: '杭州星芒活动策划', address: '杭州市西湖区', phone: '0571-88888888' };

describe('customer-sheet — 打印与 Excel 的同一份版面', () => {
  it('详细档列 = 序号/项目/规格/单位/数量/单价/小计', () => {
    expect(sheetColumns(SHEET_OPTIONS_DEFAULT).map((c) => c.header)).toEqual([
      '序号',
      '项目',
      '规格 / 说明',
      '单位',
      '数量',
      '单价',
      '小计',
    ]);
  });

  it('精简档去掉规格列，关掉单价再少一列', () => {
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
    ).toEqual(['no', 'name', 'spec', 'unit', 'qty', 'amount']);
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

  it('抬头三行与 Excel 的合并单元格一一对应', () => {
    const s = buildCustomerSheet(quote(), company);
    expect(s.meta).toEqual([
      ['报价单号：YD-2614  V1', '报价有效期：2026-12-05'],
      ['客户：星海科技', '活动：2026 年会'],
      ['活动日期：2026-12-20', '税口径：含税'],
    ]);
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

  it('备注只在详细档挂在名称后面', () => {
    const q = quote({ items: [{ ...quote().items[0]!, remark: '含安装' }] });
    expect(buildCustomerSheet(q, company).groups[0]!.rows[0]!.name).toBe('桁架背景板（含安装）');
    expect(
      buildCustomerSheet(q, company, { ...SHEET_OPTIONS_DEFAULT, layout: 'brief' }).groups[0]!.rows[0]!.name,
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
