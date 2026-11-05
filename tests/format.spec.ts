import { describe, it, expect } from 'vitest';
import { rateToPctInput, formatRate } from '../src/lib/format';

/**
 * 比率 ↔ 百分比输入框。
 *
 * 这条约束来自一次真实的丢人现场：库里 0.2800 的默认毛利率，
 * 输入框里显示成 `28.000000000000004`，客户以为系统算错了。
 * 根因是 `0.28 * 100` 在 IEEE 754 下不是 28。
 */
describe('format — 比率转百分比输入值', () => {
  it('0.28 不能变成 28.000000000000004', () => {
    expect(0.28 * 100).not.toBe(28); // 先钉住这个事实，防止有人"优化"回乘法
    expect(rateToPctInput(0.28)).toBe('28');
    expect(rateToPctInput('0.2800')).toBe('28');
  });

  it('库里出现的每一个默认值都干净', () => {
    for (const [rate, pct] of [
      ['0.1800', '18'],
      ['0.2200', '22'],
      ['0.2500', '25'],
      ['0.3200', '32'],
      ['0.1200', '12'],
      ['0.1500', '15'],
    ] as const) {
      expect(rateToPctInput(rate)).toBe(pct);
    }
  });

  it('保留到 0.01 个百分点：18.5% 不能压成 19%', () => {
    expect(rateToPctInput(0.185)).toBe('18.5');
    expect(rateToPctInput(0.2975)).toBe('29.75');
    expect(rateToPctInput(0.0041)).toBe('0.41');
  });

  it('空值给空字符串（输入框留白），不是 0', () => {
    expect(rateToPctInput(null)).toBe('');
    expect(rateToPctInput(undefined)).toBe('');
    expect(rateToPctInput('')).toBe('');
    expect(rateToPctInput('abc')).toBe('');
  });

  it('0 是合法的 0%，不是空', () => {
    expect(rateToPctInput(0)).toBe('0');
  });

  it('和展示用的 formatRate 分工不同：一个填框，一个给眼睛看', () => {
    expect(rateToPctInput(0.2857)).toBe('28.57');
    expect(formatRate(0.2857)).toBe('28.6%');
  });
});
