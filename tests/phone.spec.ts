import { describe, it, expect } from 'vitest';
import { PHONE_MIN_DIGITS, cleanPhone, phoneDigitCount, toHalfWidth } from '../src/domain/phone';

/**
 * 电话号码清洗：报价单抬头、账号、供应商开票电话共用这一套。
 * 这里守的是"同一串号码在不同入口得到同一个结果"。
 */
describe('phone — 清洗', () => {
  it('去掉首尾空白、折叠中间连续空格', () => {
    expect(cleanPhone('  0571   8888   6677  ')).toBe('0571 8888 6677');
  });

  it('全角数字与全角括号转半角（微信里复制来常是全角）', () => {
    expect(cleanPhone('（０５７１）８８８８６６７７')).toBe('(0571)88886677');
    expect(toHalfWidth('１２３')).toBe('123');
  });

  it('保留 + - 空格 括号：它们是号码的一部分，不是手误', () => {
    expect(cleanPhone('+86 138-0000-0001')).toBe('+86 138-0000-0001');
  });

  it('空值一律给空串，不返回 "null" 字符串', () => {
    expect(cleanPhone(null)).toBe('');
    expect(cleanPhone(undefined)).toBe('');
    expect(cleanPhone('   ')).toBe('');
  });
});

describe('phone — 判据', () => {
  it('只数数字，符号不计数', () => {
    expect(phoneDigitCount('+86 138-0000-0001')).toBe(13);
    expect(phoneDigitCount('(0571) 8888 6677')).toBe(12);
  });

  it('7 位是下限：座机 8 位、手机 11 位都过，分机 3 位单写不过', () => {
    expect(PHONE_MIN_DIGITS).toBe(7);
    expect(phoneDigitCount('0571-8888') >= PHONE_MIN_DIGITS).toBe(true);
    expect(phoneDigitCount('13800000001') >= PHONE_MIN_DIGITS).toBe(true);
    expect(phoneDigitCount('888') >= PHONE_MIN_DIGITS).toBe(false);
  });
});
