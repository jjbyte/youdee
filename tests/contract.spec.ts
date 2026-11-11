import { describe, it, expect } from 'vitest';
import {
  CONTRACT_LIMITS,
  isRealDate,
  normalizeAmount,
  parseContractInput,
} from '../src/domain/contract';

/**
 * 合同字段校验。
 *
 * 这里守的是"录错了查不到"这一类错：公司名多一个空格、签订日期写成 2 月 30 日、
 * 金额带着千分位直接贴进来。这些错在界面上都不显眼，只有等三个月后有人
 * 按公司名搜不到合同才会发现——那时原始凭据可能已经不在了。
 */

const full = {
  title: '秋季发布会执行合同',
  company_name: '星野科技',
  project_name: '秋季发布会',
  contract_no: 'XY-2026-014',
  signed_on: '2026-09-18',
  amount: '128000',
  note: '首付款 30%',
};

describe('isRealDate', () => {
  it('接受日历上真实存在的日期', () => {
    expect(isRealDate('2026-09-18')).toBe(true);
    expect(isRealDate('2024-02-29')).toBe(true); // 闰年
  });

  it('拒绝格式对但日历上不存在的日期', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('2025-02-29')).toBe(false); // 平年
  });

  it('拒绝非 YYYY-MM-DD 的写法', () => {
    expect(isRealDate('2026/09/18')).toBe(false);
    expect(isRealDate('26-09-18')).toBe(false);
    expect(isRealDate('2026-9-8')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

describe('normalizeAmount', () => {
  it('接受整数与一两位小数', () => {
    expect(normalizeAmount('0')).toBe('0');
    expect(normalizeAmount('128000')).toBe('128000');
    expect(normalizeAmount('12.5')).toBe('12.5');
    expect(normalizeAmount('12.50')).toBe('12.50');
  });

  it('去掉前导零，避免同一个数存成两种样子', () => {
    expect(normalizeAmount('007')).toBe('7');
    expect(normalizeAmount('0.50')).toBe('0.50');
  });

  it('拒绝会被 numeric(14,2) 静默改写的三位小数', () => {
    // 录 1000.005 的人以为存的是 1000.005，查出来却是 1000.01
    expect(normalizeAmount('1000.005')).toBeNull();
  });

  it('拒绝负数、科学计数法、千分位与货币符号', () => {
    expect(normalizeAmount('-1')).toBeNull();
    expect(normalizeAmount('1e5')).toBeNull();
    expect(normalizeAmount('1,000')).toBeNull();
    expect(normalizeAmount('¥1000')).toBeNull();
    expect(normalizeAmount('.5')).toBeNull();
  });

  it('拒绝超出 numeric(14,2) 整数位上限的数', () => {
    const max = '9'.repeat(CONTRACT_LIMITS.amountIntDigits);
    expect(normalizeAmount(max)).toBe(max);
    expect(normalizeAmount(`${max}0`)).toBeNull();
  });
});

describe('parseContractInput 新建', () => {
  it('完整输入原样通过', () => {
    const { value, issues } = parseContractInput(full, { partial: false });
    expect(issues).toEqual([]);
    expect(value).toEqual(full);
  });

  it('必填项缺失时逐条报出，且不给默认值', () => {
    const { value, issues } = parseContractInput({}, { partial: false });
    expect(issues.map((i) => i.field).sort()).toEqual(['company_name', 'title']);
    expect(value).toEqual({});
  });

  it('必填项给空白串也算缺失（不静默存成空字符串）', () => {
    const { issues } = parseContractInput({ ...full, title: '   ' }, { partial: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('title');
  });

  it('超长字段按上限拒绝', () => {
    const { issues } = parseContractInput({ ...full, company_name: '公'.repeat(121) }, { partial: false });
    expect(issues[0]!.field).toBe('company_name');
    expect(issues[0]!.message).toContain(String(CONTRACT_LIMITS.companyName));
  });

  it('签订日期写成 2 月 30 日会被拒', () => {
    const { value, issues } = parseContractInput({ ...full, signed_on: '2026-02-30' }, { partial: false });
    expect(issues[0]!.field).toBe('signed_on');
    expect(value.signed_on).toBeUndefined();
  });

  it('金额非法时拒绝，非法值不会落库', () => {
    const { value, issues } = parseContractInput({ ...full, amount: '1,280' }, { partial: false });
    expect(issues[0]!.field).toBe('amount');
    expect(value.amount).toBeUndefined();
  });

  it('可选字段留空存 null，而不是空字符串', () => {
    const { value } = parseContractInput(
      { title: '合同', company_name: '公司', project_name: '', contract_no: null, signed_on: '', amount: '', note: '' },
      { partial: false },
    );
    expect(value.project_name).toBeNull();
    expect(value.contract_no).toBeNull();
    expect(value.signed_on).toBeNull();
    expect(value.amount).toBeNull();
    expect(value.note).toBeNull();
  });

  it('剥掉 NUL 字符：Postgres 的 text 列收不下它', () => {
    const { value } = parseContractInput({ ...full, note: '备注\u0000尾巴' }, { partial: false });
    expect(value.note).toBe('备注尾巴');
  });
});

describe('parseContractInput 局部更新', () => {
  it('只校验提交过的键，没提交的键不出现（PATCH 不会把没传的字段清空）', () => {
    const { value, issues } = parseContractInput({ company_name: '星野科技（北京）' }, { partial: true });
    expect(issues).toEqual([]);
    expect(Object.keys(value)).toEqual(['company_name']);
  });

  it('局部更新里给 null 表示清空', () => {
    const { value } = parseContractInput({ signed_on: null, amount: null }, { partial: true });
    expect(value).toEqual({ signed_on: null, amount: null });
  });

  it('局部更新改成空串等于清空（可选字段），但必填字段仍然报错', () => {
    const optional = parseContractInput({ project_name: '  ' }, { partial: true });
    expect(optional.value.project_name).toBeNull();

    const required = parseContractInput({ title: '' }, { partial: true });
    expect(required.issues[0]!.field).toBe('title');
    expect(required.value.title).toBeUndefined();
  });

  it('局部更新时非法日期同样被拒', () => {
    const { issues } = parseContractInput({ signed_on: '2026/09/18' }, { partial: true });
    expect(issues[0]!.field).toBe('signed_on');
  });
});

/**
 * 乙方（客户名称）。与甲方（company_name）分开存：
 * 甲方是"我方哪个主体签的"，乙方是"签给谁"。合成一列，两个方向的查询必然有一个查不准。
 */
describe('客户名称（乙方）', () => {
  it('可选：不传也能建单（不是每份合同都能一眼看出客户主体）', () => {
    const { value, issues } = parseContractInput(full);
    expect(issues).toEqual([]);
    expect(value.customer_name).toBeUndefined();
  });

  it('首尾空格被去掉', () => {
    const { value } = parseContractInput({ customer_name: '  云图文化  ' });
    expect(value.customer_name).toBe('云图文化');
  });

  it(`超过 ${CONTRACT_LIMITS.customerName} 字被拒，并指出是哪个字段`, () => {
    const { issues } = parseContractInput(
      { customer_name: '客'.repeat(CONTRACT_LIMITS.customerName + 1) },
      { partial: true },
    );
    expect(issues[0]!.field).toBe('customer_name');
    expect(issues[0]!.message).toContain('客户名称');
  });

  it('PATCH 里给 null 表示清空（合同签给了别的主体）', () => {
    const { value } = parseContractInput({ customer_name: null }, { partial: true });
    expect(value).toEqual({ customer_name: null });
  });
});
