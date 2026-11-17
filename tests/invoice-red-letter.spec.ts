/**
 * 红字票 → 原发票号码的抽取。
 *
 * 这是全流程里唯一"读错会改到别人账上"的地方：认错号码，界面就会提示用户
 * 把另一张无辜的票标成「已冲红」。所以每条写法都留一个用例，
 * 认不出来的情形也留一条（宁可少问一次，也不要瞎猜一个号码）。
 */
import { describe, expect, it } from 'vitest';
import { extractOriginalFromFields, extractOriginalInvoiceNo } from '../src/domain/invoice-red-letter';
import { contractExpiry } from '../src/lib/contract-expiry';
import { invoiceDisplayStatus, invoiceStatusLabel } from '../src/lib/labels';

describe('红字票的原发票号码', () => {
  it('数电写法：被红冲蓝字数电发票号码', () => {
    const r = extractOriginalInvoiceNo(['备注：被红冲蓝字数电发票号码：25112000000012345678']);
    expect(r.invoiceNo).toBe('25112000000012345678');
    expect(r.label).toBe('被红冲蓝字数电发票号码');
  });

  it('税控写法：对应正数发票号码（代码-号码，取号码那一段）', () => {
    const r = extractOriginalInvoiceNo(['对应正数发票号码：044031900111-12345678']);
    expect(r.invoiceNo).toBe('12345678');
  });

  it('纸质红字：原发票号码（半角冒号、带空格也认）', () => {
    expect(extractOriginalInvoiceNo(['原发票号码: 12345678 ']).invoiceNo).toBe('12345678');
    expect(extractOriginalInvoiceNo(['原发票号码 ：12345678']).invoiceNo).toBe('12345678');
  });

  it('全角数字先转半角再认（OCR 常见）', () => {
    const r = extractOriginalInvoiceNo(['原发票号码：１２３４５６７８']);
    expect(r.invoiceNo).toBe('12345678');
  });

  it('多段文字按传入顺序取第一个认出来的（结构化字段优先于备注）', () => {
    const r = extractOriginalInvoiceNo([
      '',
      null,
      '备注里也有一句：原发票号码：99998888',
      '被红冲蓝字数电发票号码：25112000000012345678',
    ]);
    // 第二段（备注）先出现，所以它赢——顺序由调用方决定，这里只保证"第一个赢"
    expect(r.invoiceNo).toBe('99998888');
  });

  it('只有标签没有号码 → null（不抓旁边的其他数字）', () => {
    const r = extractOriginalInvoiceNo(['原发票号码：见附件', '价税合计 1130.00']);
    expect(r.invoiceNo).toBeNull();
    expect(r.label).toBeNull();
  });

  it('没有任何标签 → null（20 位数字裸奔时不猜）', () => {
    expect(extractOriginalInvoiceNo(['25112000000012345678']).invoiceNo).toBeNull();
    expect(extractOriginalInvoiceNo([null, undefined, '']).invoiceNo).toBeNull();
  });
});

/**
 * 结构化字段那条路（真样张补的）。
 *
 * 铁路电子客票的红字票把原票号码放在 `OriginalNumber` 里，票面上**一个字都没写**
 * "原发票号码"。0.1.39 只把这些字段的**值**当成文字交给标签匹配 → 值里没有标签 →
 * 永远返回 null，那张原票就一直显示「正常」。所以这条路必须单独测。
 */
describe('红字票的原票号码（结构化字段）', () => {
  /** 真样张：思凡的红字铁路票 */
  const RAIL_RED = {
    Number: '26949334178000034160',
    OriginalNumber: '26949134178001843878',
    Fare: '-306.50',
    Tax: '-25.31',
    Total: '-281.19',
  };

  it('原票号直接给在 OriginalNumber 里 → 取值，label 记字段名', () => {
    const r = extractOriginalFromFields(RAIL_RED, RAIL_RED.Number);
    expect(r.invoiceNo).toBe('26949134178001843878');
    expect(r.label).toBe('OriginalNumber');
  });

  it('纸质票的「代码-号码」写法取右段', () => {
    const r = extractOriginalFromFields({ OriginalInvoiceNo: '044031900111-12345678' });
    expect(r.invoiceNo).toBe('12345678');
  });

  it('8 位纸质号码与 20 位全电号码都收，其它长度一律不收（没有标签的数字只能靠形态判断）', () => {
    expect(extractOriginalFromFields({ OriginalNumber: '12345678' }).invoiceNo).toBe('12345678');
    expect(extractOriginalFromFields({ OriginalNumber: '25112000000012345678' }).invoiceNo).toBe(
      '25112000000012345678',
    );
    // 9 位 / 6 位 / 带汉字 → 不是发票号码，宁可不猜
    expect(extractOriginalFromFields({ OriginalNumber: '123456789' }).invoiceNo).toBeNull();
    expect(extractOriginalFromFields({ OriginalNumber: 'G3811' }).invoiceNo).toBeNull();
    expect(extractOriginalFromFields({ OriginalNumber: '08车05D号' }).invoiceNo).toBeNull();
  });

  it('字段里放的是本票号码 → 不采信（那就是"冲自己"）', () => {
    const r = extractOriginalFromFields(RAIL_RED, '26949134178001843878');
    expect(r.invoiceNo).toBeNull();
  });

  it('字段全是空 / 非字符串 → null，不抛错', () => {
    expect(extractOriginalFromFields({}).invoiceNo).toBeNull();
    expect(extractOriginalFromFields({ OriginalNumber: null, OriginalInvoiceNo: 123 }).invoiceNo).toBeNull();
    expect(extractOriginalFromFields({ OriginalNumber: '   ' }).invoiceNo).toBeNull();
  });
});

describe('合同到期的人话', () => {
  it('一个月内：按天说，色调是 soon', () => {
    const e = contractExpiry('2026-03-31', '2026-03-19');
    expect(e).toEqual({ daysLeft: 12, tone: 'soon', text: '还剩 12 天' });
  });

  it('今天到期与已过期都算 expired（过期的不能被静默丢掉）', () => {
    expect(contractExpiry('2026-03-19', '2026-03-19')?.text).toBe('今天到期');
    const past = contractExpiry('2026-03-01', '2026-03-19');
    expect(past?.daysLeft).toBe(-18);
    expect(past?.tone).toBe('expired');
    expect(past?.text).toBe('已过期 18 天');
  });

  it('一个月以上按月说（写「还有 214 天」反而看不出远近）', () => {
    const e = contractExpiry('2027-01-05', '2026-03-19');
    expect(e?.tone).toBe('normal');
    expect(e?.text).toBe('还有约 10 个月');
  });

  it('没有终止日期 = 非周期性合同，返回 null', () => {
    expect(contractExpiry(null, '2026-03-19')).toBeNull();
    expect(contractExpiry('', '2026-03-19')).toBeNull();
    expect(contractExpiry('2026/03/19', '2026-03-19')).toBeNull();
  });
});

/**
 * 状态栏三选一（0.1.42 客户要求）。
 *
 * 红字票不再显示「正常」：票面是负数、旁边写着"冲 XXXXX"，状态栏却写正常，
 * 客户会直接问"你们是不是算错了"。但它也不是第三种 `status`——
 * 只是展示层让 `is_red_letter` 盖过 status，金额符号仍只认一列。
 */
describe('发票状态栏：正常 / 已冲红 / 红字票', () => {
  it('红字票优先：即使 status 是 normal 也显示「红字票」', () => {
    expect(invoiceDisplayStatus({ isRedLetter: true, status: 'normal' })).toEqual({
      label: '红字票',
      tone: 'warn',
    });
  });

  it('普通蓝票按 status 走：正常 / 已冲红', () => {
    expect(invoiceDisplayStatus({ isRedLetter: false, status: 'normal' })).toEqual({
      label: '正常',
      tone: 'neutral',
    });
    expect(invoiceDisplayStatus({ isRedLetter: false, status: 'red' })).toEqual({
      label: '已冲红',
      tone: 'danger',
    });
  });

  it('互相排斥：红字票永远不会显示「已冲红」（即便库里脏成 red）', () => {
    expect(invoiceDisplayStatus({ isRedLetter: true, status: 'red' }).label).toBe('红字票');
  });

  it('文案与领域层的状态码表同源（改一处不会漏另一处）', () => {
    expect(invoiceStatusLabel('normal')).toBe('正常');
    expect(invoiceStatusLabel('red')).toBe('已冲红');
  });
});
