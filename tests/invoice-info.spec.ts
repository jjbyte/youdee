import { describe, it, expect } from 'vitest';
import {
  INVOICE_KEYS,
  invoiceFilledCount,
  normalizeBankAccount,
  normalizeInvoiceField,
  normalizeInvoicePhone,
  normalizeInvoiceText,
  normalizeTaxNo,
} from '../src/domain/invoice-info';

/**
 * 开票信息五项。
 *
 * 这条需求的原文是「可选字段」，所以这里除了"该拦的拦住"，还要钉住另一半：
 * **全空是合法的**。一旦有人把税号改成必填，这家公司就没法先建档后补票了。
 */
describe('invoice-info — 纳税人识别号', () => {
  it('18 位统一社会信用代码通过', () => {
    expect(normalizeTaxNo('91310114MA1GX8Q23K')).toEqual({ value: '91310114MA1GX8Q23K' });
  });

  it('15 位老税号也通过（别把存量客户挡在门外）', () => {
    expect(normalizeTaxNo('310114000123456').value).toBe('310114000123456');
  });

  it('小写字母转大写、全角转半角、空格与横杠去掉', () => {
    expect(normalizeTaxNo('91310114ma1gx8q23k').value).toBe('91310114MA1GX8Q23K');
    expect(normalizeTaxNo('９１３１０１１４ＭＡ１ＧＸ８Ｑ２３Ｋ').value).toBe('91310114MA1GX8Q23K');
    expect(normalizeTaxNo('9131 0114 MA1G-X8Q23K').value).toBe('91310114MA1GX8Q23K');
  });

  it('太短 / 太长 / 带汉字都报错，且说清是几位', () => {
    expect(normalizeTaxNo('91310114').error).toBeTruthy();
    expect(normalizeTaxNo('91310114MA1GX8Q23KXYZ').error).toBeTruthy();
    expect(normalizeTaxNo('91310114MA1GX8Q2三K').error).toBeTruthy();
  });

  it('空值合法（可选字段），空串与全空格都算没填', () => {
    expect(normalizeTaxNo('')).toEqual({ value: null });
    expect(normalizeTaxNo('   ')).toEqual({ value: null });
    expect(normalizeTaxNo(null)).toEqual({ value: null });
  });

  it('不校验校验位：长度字符集对就放行', () => {
    // 最后一位是错的校验位，但格式合法 —— 拦住它会让正确的新税号也进不来
    expect(normalizeTaxNo('91310114MA1GX8Q23Z').value).toBe('91310114MA1GX8Q23Z');
  });
});

describe('invoice-info — 银行账号', () => {
  it('空格和横杠不是账号的一部分', () => {
    expect(normalizeBankAccount('1001 2004 0900 6789 123').value).toBe('1001200409006789123');
    expect(normalizeBankAccount('6222-0212-3456-7890').value).toBe('6222021234567890');
  });

  it('带字母报错（账号只会是数字）', () => {
    expect(normalizeBankAccount('6222 0212 3456 ABCD').error).toBeTruthy();
  });

  it('6–32 位之外报错', () => {
    expect(normalizeBankAccount('12345').error).toBeTruthy();
    expect(normalizeBankAccount('1'.repeat(33)).error).toBeTruthy();
    expect(normalizeBankAccount('1'.repeat(32)).value).toHaveLength(32);
  });
});

describe('invoice-info — 联系电话与文本', () => {
  it('座机和手机都过，格式不强行统一', () => {
    expect(normalizeInvoicePhone('0571-8888 6666').value).toBe('0571-8888 6666');
    expect(normalizeInvoicePhone('13800000001').value).toBe('13800000001');
    expect(normalizeInvoicePhone('(021) 5998 6677').value).toBe('(021) 5998 6677');
  });

  it('少于 7 位数字报错——那不是能开票的号', () => {
    expect(normalizeInvoicePhone('12345').error).toBeTruthy();
  });

  it('地址超长报错而不是静默截断', () => {
    expect(normalizeInvoiceText('company_address', '杭'.repeat(201)).error).toContain('200');
    expect(normalizeInvoiceText('company_address', '杭'.repeat(200)).value).toHaveLength(200);
  });

  it('分派函数把每一格送到对的规则上', () => {
    expect(normalizeInvoiceField('tax_no', '9131 0114 MA1GX8Q23K').value).toBe('91310114MA1GX8Q23K');
    expect(normalizeInvoiceField('bank_account', '6222 0212 3456').value).toBe('622202123456');
    expect(normalizeInvoiceField('bank_name', '  工行杭州分行  ').value).toBe('工行杭州分行');
  });
});

describe('invoice-info — 计数（详情抽屉用它决定这一块显不显示）', () => {
  it('五项全空 = 0，整块不出现', () => {
    expect(invoiceFilledCount({})).toBe(0);
    expect(invoiceFilledCount(null)).toBe(0);
    expect(
      invoiceFilledCount({
        tax_no: '',
        company_address: null,
        company_phone: '   ',
        bank_name: undefined,
        bank_account: '',
      }),
    ).toBe(0);
  });

  it('填了几项就是几项', () => {
    expect(
      invoiceFilledCount({
        tax_no: '91310114MA1GX8Q23K',
        company_address: '上海市嘉定区',
        company_phone: null,
        bank_name: null,
        bank_account: null,
      }),
    ).toBe(2);
  });

  it('界面顺序 = 财务念发票的顺序', () => {
    expect(INVOICE_KEYS).toEqual(['tax_no', 'company_address', 'company_phone', 'bank_name', 'bank_account']);
  });
});
