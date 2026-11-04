import { describe, it, expect } from 'vitest';
import { computeComparison, summarizeCompare, type CompareRawRow } from '../src/domain/compare';

const TODAY = '2026-11-04';

function row(over: Partial<CompareRawRow> & Pick<CompareRawRow, 'priceId' | 'supplierName'>): CompareRawRow {
  return {
    supplierId: `sup-${over.priceId}`,
    supplierType: 'factory',
    pricingNature: 'custom_made',
    unitCode: 'sqm',
    baseUnitQty: null,
    unitPrice: '55',
    moq: null,
    taxIncluded: true,
    unitMode: null,
    tiers: [],
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'active',
    lastUsedAt: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

const base = {
  compareUnitCode: 'sqm',
  qtyBase: '10',
  taxBasis: 'inclusive' as const,
  onDate: TODAY,
  staleDaysThreshold: 90,
};

describe('compare — 单位折算（TC-2 组）', () => {
  it('淘宝 5元/张、1㎡=12张 → 折成 60 元/㎡，比厂里 55 元/㎡ 贵', () => {
    const groups = computeComparison({
      ...base,
      rows: [
        row({ priceId: 'a', supplierName: '淘宝-喷绘之家', supplierType: 'online', unitCode: 'sheet', unitPrice: '5', baseUnitQty: '12' }),
        row({ priceId: 'b', supplierName: '金桥喷绘厂', unitCode: 'sqm', unitPrice: '55' }),
      ],
    });
    const g = groups[0]!;
    expect(g.comparableCount).toBe(2);
    const taobao = g.rows.find((r) => r.priceId === 'a')!;
    expect(taobao.compareState).toBe('converted');
    expect(taobao.baseUnitPrice).toBe('60.0000');
    expect(g.rows.find((r) => r.priceId === 'b')!.isLowest).toBe(true);
    expect(taobao.isLowest).toBe(false);
    expect(taobao.deltaVsLowest).toBeCloseTo(0.0909, 3); // 贵 9.09%
  });

  it('未填折算系数的行不参与排序，但**必须仍然返回**（TC-2.3/2.9）', () => {
    const groups = computeComparison({
      ...base,
      rows: [
        row({ priceId: 'a', supplierName: '淘宝-无系数', supplierType: 'online', unitCode: 'sheet', unitPrice: '4.50', baseUnitQty: null }),
        row({ priceId: 'b', supplierName: '金桥喷绘厂', unitCode: 'sqm', unitPrice: '55' }),
      ],
    });
    const g = groups[0]!;
    expect(g.rows).toHaveLength(2); // 绝不静默删除
    const unknown = g.rows.find((r) => r.priceId === 'a')!;
    expect(unknown.compareState).toBe('not_comparable');
    expect(unknown.exclusiveReason).toBe('UNIT_NOT_COMPARABLE');
    expect(unknown.isLowest).toBe(false);
    expect(unknown.baseUnitPrice).toBeNull();
    // 关键：4.50 比 55 小，但绝不能被标成最低
    expect(g.lowestBaseUnitPrice).toBe('55.0000');
  });

  it('主体未设比价基准单位时，全部不可比但不报错', () => {
    const groups = computeComparison({
      ...base,
      compareUnitCode: null,
      rows: [row({ priceId: 'a', supplierName: '甲', unitPrice: '55' })],
    });
    expect(groups[0]!.comparableCount).toBe(1);
  });
});

describe('compare — 税口径不混比（TC-4 组，结论会相反）', () => {
  const rows = [
    row({ priceId: 'a', supplierName: 'A 不含税', unitPrice: '100', taxIncluded: false }),
    row({ priceId: 'b', supplierName: 'B 含税', unitPrice: '105', taxIncluded: true }),
  ];

  it('本单报含税 → B 参与排序，A 被标口径不同且置底', () => {
    const g = computeComparison({ ...base, taxBasis: 'inclusive', rows })[0]!;
    const a = g.rows.find((r) => r.priceId === 'a')!;
    expect(a.exclusiveReason).toBe('TAX_BASIS_MISMATCH');
    expect(g.lowestBaseUnitPrice).toBe('105.0000');
    expect(g.comparableCount).toBe(1);
  });

  it('本单报不含税 → A 参与排序，结论与含税口径相反', () => {
    const g = computeComparison({ ...base, taxBasis: 'exclusive', rows })[0]!;
    expect(g.lowestBaseUnitPrice).toBe('100.0000');
    expect(g.rows.find((r) => r.priceId === 'b')!.exclusiveReason).toBe('TAX_BASIS_MISMATCH');
  });

  it('两种口径都不参与排序的行，仍保留在列表里（不许消失）', () => {
    const g = computeComparison({ ...base, taxBasis: 'inclusive', rows })[0]!;
    expect(g.totalCount).toBe(2);
    expect(g.rows).toHaveLength(2);
  });
});

describe('compare — 交易性质分组（TC-3 组）', () => {
  it('LED 买断 8000 与租赁 500/天 分属两组，不混比', () => {
    const groups = computeComparison({
      ...base,
      compareUnitCode: null,
      rows: [
        row({ priceId: 'a', supplierName: '淘宝-买断', pricingNature: 'purchase', unitCode: 'block', unitPrice: '8000' }),
        row({ priceId: 'b', supplierName: '星光灯光', supplierType: 'rental', pricingNature: 'rental_per_day', unitCode: 'day', unitMode: 'per_day', unitPrice: '500' }),
      ],
    });
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.pricingNature)).toEqual(['purchase', 'rental_per_day']);
    for (const g of groups) expect(g.rows).toHaveLength(1); // 各组只有自己那条
  });

  it('人员按场 2800 与按天 1500 必须分组，不允许出现「最低 1500」（TC-3B）', () => {
    const groups = computeComparison({
      ...base,
      compareUnitCode: null,
      rows: [
        row({ priceId: 'a', supplierName: '张启明（按场）', pricingNature: 'service', unitCode: 'session', unitMode: 'per_event', unitPrice: '2800' }),
        row({ priceId: 'b', supplierName: '李工（按天）', pricingNature: 'service', unitCode: 'day', unitMode: 'per_day', unitPrice: '1500' }),
      ],
    });
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.unitMode)).toEqual(['per_day', 'per_event']); // 按天排在前
    // 关键断言：每组各算各的最低价，按场那组不许被"按天的 1500"压成最低
    expect(groups[0]!.lowestBaseUnitPrice).toBe('1500.0000');
    expect(groups[1]!.lowestBaseUnitPrice).toBe('2800.0000');
    expect(groups[1]!.lowestSupplierId).toBe('sup-a');
  });
});

describe('compare — 数量必须按 scale2 换算（否则档位全错）', () => {
  it('qty_base 是「比价基准单位」的数量，换算到供应商计价单位后要落在正确档', () => {
    // 基准 = ㎡，该供应商按张售，1㎡ = 2 张；买 18㎡ → 36 张
    // 阶梯 30 张起降到 40 元。若数量被放大 100 倍（1800 张），会命中 500 档的 38 元 —— 少报 2 元/张。
    const g = computeComparison({
      ...base,
      compareUnitCode: 'sqm',
      qtyBase: '18',
      rows: [row({
        priceId: 'a', supplierName: '甲', unitCode: 'sheet', baseUnitQty: '2',
        unitPrice: '45',
        tiers: [{ minQty: '1', unitPrice: '45' }, { minQty: '30', unitPrice: '40' }, { minQty: '500', unitPrice: '38' }],
      })],
    })[0]!;
    expect(g.rows[0]!.unitPriceAtQty).toBe('40.0000');
    expect(g.rows[0]!.tierCase).toBe('in_tier');
  });
});

describe('compare — 阶梯价命中（TC-1 组）', () => {
  it('按数量命中对应档', () => {
    const g = computeComparison({
      ...base,
      qtyBase: '120',
      rows: [row({
        priceId: 'a', supplierName: '甲', unitPrice: '55',
        tiers: [{ minQty: '1', unitPrice: '55' }, { minQty: '100', unitPrice: '48' }, { minQty: '500', unitPrice: '42' }],
      })],
    })[0]!;
    expect(g.rows[0]!.unitPriceAtQty).toBe('48.0000');
    expect(g.rows[0]!.tierCase).toBe('in_tier');
  });

  it('超过最高档用最高档，不报错', () => {
    const g = computeComparison({
      ...base,
      qtyBase: '9999',
      rows: [row({
        priceId: 'a', supplierName: '甲', unitPrice: '55',
        tiers: [{ minQty: '1', unitPrice: '55' }, { minQty: '100', unitPrice: '48' }],
      })],
    })[0]!;
    expect(g.rows[0]!.unitPriceAtQty).toBe('48.0000');
    expect(g.rows[0]!.tierCase).toBe('above_max');
  });

  it('低于起订量：给警告但照常计价（不阻断）', () => {
    const g = computeComparison({
      ...base,
      qtyBase: '5',
      rows: [row({ priceId: 'a', supplierName: '甲', unitPrice: '55', moq: '10' })],
    })[0]!;
    expect(g.rows[0]!.tierCase).toBe('below_moq');
    expect(g.rows[0]!.warnings.some((w) => w.includes('起订量'))).toBe(true);
    expect(g.rows[0]!.isLowest).toBe(true);
  });
});

describe('compare — 价格状态（TC-5 组）', () => {
  it('软陈旧（超 90 天未核价但仍在有效期）→ 仍可参与比价，只提醒', () => {
    const g = computeComparison({
      ...base,
      rows: [row({ priceId: 'a', supplierName: '甲', updatedAt: '2026-01-01T00:00:00.000Z' })],
    })[0]!;
    expect(g.rows[0]!.effectiveState).toBe('soft_stale');
    expect(g.rows[0]!.isLowest).toBe(true);
    expect(g.rows[0]!.warnings.some((w) => w.includes('未核价'))).toBe(true);
  });

  it('last_used_at 会重置陈旧计时（187 天没改但上周用过 → 仍是有效）', () => {
    const g = computeComparison({
      ...base,
      rows: [row({
        priceId: 'a', supplierName: '甲',
        updatedAt: '2026-04-01T00:00:00.000Z',
        lastUsedAt: '2026-10-28T00:00:00.000Z',
      })],
    })[0]!;
    expect(g.rows[0]!.effectiveState).toBe('active');
  });

  it('已过硬失效日（闭区间：失效日当天仍有效）→ 不参与排序但保留', () => {
    const stillValid = computeComparison({
      ...base,
      onDate: '2026-10-31',
      rows: [row({ priceId: 'a', supplierName: '甲', effectiveTo: '2026-10-31' })],
    })[0]!;
    expect(stillValid.rows[0]!.effectiveState).toBe('active');

    const expired = computeComparison({
      ...base,
      onDate: '2026-11-01',
      rows: [row({ priceId: 'a', supplierName: '甲', effectiveTo: '2026-10-31' })],
    })[0]!;
    expect(expired.rows[0]!.effectiveState).toBe('hard_expired');
    expect(expired.rows[0]!.isLowest).toBe(false);
    expect(expired.rows).toHaveLength(1);
  });
});

describe('compare — 摘要条（宣传截图那一屏）', () => {
  it('分别给出线上最低与线下最低，并算出差价率', () => {
    const groups = computeComparison({
      ...base,
      rows: [
        row({ priceId: 'a', supplierName: '喷绘之家', supplierType: 'online', unitPrice: '32' }),
        row({ priceId: 'b', supplierName: '金桥桁架厂', supplierType: 'factory', unitPrice: '28' }),
      ],
    });
    const s = summarizeCompare(groups[0]!);
    expect(s.onlineLowest).toContain('32.00');
    expect(s.offlineLowest).toContain('28.00');
    expect(s.offlineCheaperRate).toBeCloseTo(0.125, 3); // 线下便宜 12.5%
    expect(s.lowestText).toContain('28.00');
  });
});
