/**
 * 红字票 → 原发票号码的抽取。
 *
 * 这是全流程里唯一"读错会改到别人账上"的地方：认错号码，界面就会提示用户
 * 把另一张无辜的票标成「已冲红」。所以每条写法都留一个用例，
 * 认不出来的情形也留一条（宁可少问一次，也不要瞎猜一个号码）。
 */
import { describe, expect, it } from 'vitest';
import { extractOriginalInvoiceNo } from '../src/domain/invoice-red-letter';
import { contractExpiry } from '../src/lib/contract-expiry';

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
