import { describe, it, expect } from 'vitest';
import { formatDecimalString, MINUS, EM_DASH } from '../src/lib/format';

/**
 * 发票金额的直通格式化（**不经过 Number**）。
 *
 * 为什么不让它走 formatMoney：那条路先 `Number()` 再 `toFixed(2)`。
 * `1900.10` → `1900.1` → 靠 toFixed 才补回两位；有效数字一多，
 * 最后一位就可能被改掉。台账金额是要跟税局核对的，改一位就是错账。
 */
describe('formatDecimalString — 金额字符串不改值', () => {
  it('两位小数原样保留，包括结尾的 0', () => {
    expect(formatDecimalString('1900.10')).toBe('1,900.10');
    expect(formatDecimalString('0.50')).toBe('0.50');
    expect(formatDecimalString('12')).toBe('12.00');
  });

  it('大额不丢精度（numeric(14,2) 上限附近）', () => {
    expect(formatDecimalString('999999999999.99')).toBe('999,999,999,999.99');
    // 这个数一旦经过 Number 再 toFixed，最后一位就不可靠了
    expect(formatDecimalString('123456789.01')).toBe('123,456,789.01');
  });

  it('负数用真正的负号 U+2212（与数字同宽，右对齐才对得齐）', () => {
    expect(formatDecimalString('-3400')).toBe(`${MINUS}3,400.00`);
    expect(formatDecimalString('-0.01')).toBe(`${MINUS}0.01`);
  });

  it('负零不显示负号：−0.00 会让人以为欠了钱', () => {
    expect(formatDecimalString('-0.00')).toBe('0.00');
    expect(formatDecimalString('-0')).toBe('0.00');
  });

  it('空值是 em dash，不是 0（0 会被当成"这张票金额是零"）', () => {
    expect(formatDecimalString(null)).toBe(EM_DASH);
    expect(formatDecimalString(undefined)).toBe(EM_DASH);
    expect(formatDecimalString('')).toBe(EM_DASH);
  });

  it('货币符号只给需要的地方（列头只出现一次）', () => {
    expect(formatDecimalString('1900.10', { symbol: true })).toBe('¥1,900.10');
    expect(formatDecimalString('-1900', { symbol: true })).toBe(`${MINUS}¥1,900.00`);
  });

  it('不是纯十进制就给 em dash，不猜', () => {
    // 带千分位的串说明上游已经被人格式化过（不是 numeric 原样出来的）。
    // 这种值宁可显示 "—" 让人去查，也不能猜成 1900.1 —— 猜错一位就是错账。
    expect(formatDecimalString('1,900.10')).toBe(EM_DASH);
    expect(formatDecimalString('abc')).toBe(EM_DASH);
  });
});
