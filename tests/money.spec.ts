import { describe, it, expect } from 'vitest';
import {
  parseMoney, formatMoney, fmtPrice, fmtAmount, fmtQty, parseQty,
  multiplyPriceByQty, applyConversion, qtyToPricingUnit,
  priceFromMargin, marginRate, divRoundHalfUp,
} from '../src/domain/money';

describe('money — 定点运算（零浮点）', () => {
  it('解析与格式化不丢精度', () => {
    expect(formatMoney(parseMoney('45'))).toBe('45.00');
    expect(formatMoney(parseMoney('12.3456'))).toBe('12.35');
    expect(formatMoney(parseMoney('-7.005'))).toBe('-7.01'); // HALF_UP，不是 half-even
    expect(formatMoney(parseMoney(0.1 + 0.2))).toBe('0.30');
  });

  it('toFixed 的 half-even 会算错钱，必须用 HALF_UP', () => {
    // 反例对照：JS 原生
    expect((2.5).toFixed(0)).toBe('3'); // 2.5 恰好向上
    expect((1.005).toFixed(2)).toBe('1.00'); // ← 这是坑，财务应为 1.01
    expect(formatMoney(parseMoney('1.005'))).toBe('1.01');
  });

  it('divRoundHalfUp 对负数按绝对值舍入', () => {
    expect(divRoundHalfUp(-250n, 100n)).toBe(-3n);
    expect(divRoundHalfUp(249n, 100n)).toBe(2n);
    expect(divRoundHalfUp(250n, 100n)).toBe(3n);
  });

  it('单价 × 数量 → 金额，先算后舍（不得先舍单价再乘）', () => {
    // 12.3456 元 × 3 = 37.0368 → 37.04
    expect(fmtAmount(multiplyPriceByQty(parseMoney('12.3456'), parseQty('3')))).toBe('37.04');
    // 0.335 × 3 = 1.005 → 1.01（若先把单价舍到 0.34 再乘得 1.02，是错的）
    expect(fmtAmount(multiplyPriceByQty(parseMoney('0.335'), parseQty('3')))).toBe('1.01');
  });

  it('非法输入抛错，绝不静默变 0', () => {
    expect(() => parseMoney('')).toThrow();
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney(null)).toThrow();
  });
});

describe('money — 单位折算（只有乘法）', () => {
  it('喷绘布：淘宝 5 元/张，1㎡=12张 → 60 元/㎡', () => {
    const normalized = applyConversion(parseMoney('5'), '12');
    expect(fmtPrice(normalized, 2)).toBe('60.00');
  });

  it('数量也要换算：买 10㎡ = 120 张', () => {
    const qtyPriced = qtyToPricingUnit(parseQty('10'), '12');
    expect(fmtQty(qtyPriced)).toBe('120.00');
  });

  it('桁架：1 根 = 3m → 45 元/根 折为 15 元/m', () => {
    // 基准 m，该供应商按根报 45，1m = 1/3 根 → base_unit_qty = 0.3333
    const normalized = applyConversion(parseMoney('45'), '0.3333');
    expect(fmtPrice(normalized, 2)).toBe('15.00');
  });

  it('未填折算系数必须抛错，不能当 1 处理', () => {
    expect(() => applyConversion(parseMoney('5'), null)).toThrow();
    expect(() => qtyToPricingUnit(parseQty('1'), null)).toThrow();
  });
});

describe('money — 毛利率（分母是报价合计）', () => {
  it('成本 100、报价 150 → 毛利率 33.33%', () => {
    expect(marginRate(parseMoney('50'), parseMoney('150'))).toBeCloseTo(0.3333, 3);
  });

  it('加价率 40% ≠ 毛利率 40%：成本 100 加 40 个点 = 140，毛利率只有 28.57%', () => {
    const sale = parseMoney('100') + (parseMoney('100') * 40n) / 100n;
    expect(formatMoney(sale)).toBe('140.00');
    expect(marginRate(sale - parseMoney('100'), sale)).toBeCloseTo(0.2857, 3);
    // 而系统里"毛利率 40%"对应的是 100 / 0.6 = 166.67
    expect(formatMoney(priceFromMargin(parseMoney('100'), 0.4))).toBe('166.67');
  });

  it('分母为 0 返回 null（界面显示 em dash，不是 0%）', () => {
    expect(marginRate(parseMoney('0'), parseMoney('0'))).toBeNull();
  });

  it('反推对客价：成本 100、毛利率 40% → 166.67', () => {
    expect(fmtPrice(priceFromMargin(parseMoney('100'), 0.4), 2)).toBe('166.67');
  });

  it('毛利率 100% 无法反推，必须抛错', () => {
    expect(() => priceFromMargin(parseMoney('100'), 1)).toThrow();
  });
});
