import { describe, it, expect } from 'vitest';
import { calcQuote, runRiskCheck, riskLevelOf, applyTargetMargin, type RiskCheckInput } from '../src/domain/quote-calc';
import { evaluateIssueBlocking, canEdit, canIssue, isExpired } from '../src/domain/quote-status';
import { canCreatePrice, canOverridePrice, canExportInternal } from '../src/domain/permissions';

const line = (over: Partial<Parameters<typeof calcQuote>[0]['lines'][number]> = {}) => ({
  qty: '10',
  costUnitPrice: '100',
  saleUnitPrice: '150',
  costSource: 'price_book' as const,
  isVisibleToCustomer: true,
  ...over,
});

describe('quote-calc — 金额计算', () => {
  it('行小计与整单合计', () => {
    const r = calcQuote({
      lines: [line(), line({ qty: '2', costUnitPrice: '500', saleUnitPrice: '800' })],
      discountAmount: '0',
    });
    expect(r.totalCost).toBe('2000.00'); // 1000 + 1000
    expect(r.totalPrice).toBe('3100.00'); // 1500 + 1600
    expect(r.totalProfit).toBe('1100.00');
    expect(r.marginRate).toBeCloseTo(0.3548, 3);
  });

  it('整单优惠从报价合计里扣，毛利率分母跟着变小', () => {
    const r = calcQuote({ lines: [line()], discountAmount: '100' });
    expect(r.totalPrice).toBe('1400.00');
    expect(r.totalProfit).toBe('400.00');
    expect(r.marginRate).toBeCloseTo(0.2857, 3);
  });

  it('一键按毛利率反推对客价', () => {
    expect(applyTargetMargin('100', 0.4)).toBe('166.6667');
  });
});

describe('quote-status — 阻断边界（产品首日存活的关键）', () => {
  it('负毛利不阻断（有些单是故意亏的）', () => {
    const r = evaluateIssueBlocking({ hasLineWithoutCost: false, customerName: '星海科技', eventName: '2026年会' });
    expect(r.blocked).toBe(false);

    const t = calcQuote({ lines: [line({ saleUnitPrice: '80' })], discountAmount: '0' });
    expect(Number(t.totalProfit)).toBeLessThan(0);
    // 计算归计算，阻断归阻断：
    expect(evaluateIssueBlocking({ hasLineWithoutCost: false, customerName: 'x', eventName: 'y' }).blocked).toBe(false);
  });

  it('客户名为空 → 阻断（客户版不是能发出去的文件）', () => {
    const r = evaluateIssueBlocking({ hasLineWithoutCost: false, customerName: '  ', eventName: '年会' });
    expect(r.blocked).toBe(true);
    expect(r.blockers[0]).toContain('客户名称');
  });

  it('有行没成本 → 阻断', () => {
    const r = evaluateIssueBlocking({ hasLineWithoutCost: true, customerName: 'x', eventName: 'y' });
    expect(r.blocked).toBe(true);
  });

  it('只有 draft 能编辑、能出单', () => {
    expect(canEdit('draft')).toBe(true);
    expect(canEdit('issued')).toBe(false);
    expect(canIssue('draft')).toBe(true);
    expect(canIssue('issued')).toBe(false);
  });

  it('失效由 valid_until 派生，不落库', () => {
    expect(isExpired('issued', '2026-10-01', '2026-11-04')).toBe(true);
    expect(isExpired('issued', '2026-12-01', '2026-11-04')).toBe(false);
    expect(isExpired('draft', '2026-10-01', '2026-11-04')).toBe(false);
  });
});

describe('quote-calc — 发送前自检 8 条', () => {
  const baseInput = (): RiskCheckInput => {
    const lines = [line()];
    return {
      status: 'draft' as const,
      customerName: '星海科技',
      eventName: '2026 年会《向新而行》',
      eventDate: '2026-12-20',
      taxBasis: 'inclusive' as const,
      lines: lines.map((l) => ({ ...l, itemName: '桁架背景板', pricingNature: 'custom_made' })),
      totals: calcQuote({ lines, discountAmount: '0' }),
      marginWarnRate: 0.25,
      marginWarnSource: 'global_default' as const,
      today: '2026-11-04',
    };
  };

  it('健康的单：零发现', () => {
    const f = runRiskCheck(baseInput());
    expect(f).toHaveLength(0);
  });

  it('R1 毛利率低于阈值 → warning，不是 blocker', () => {
    const input = baseInput();
    input.totals = calcQuote({ lines: [line({ saleUnitPrice: '110' })], discountAmount: '0' });
    const f = runRiskCheck(input);
    const r1 = f.find((x) => x.code === 'R1_MARGIN_LOW');
    expect(r1?.level).toBe('warning');
    expect(riskLevelOf(f).blocked).toBe(false);
  });

  it('R1 文案要说明是哪个阈值（按项目类型 or 默认）', () => {
    const input = baseInput();
    input.totals = calcQuote({ lines: [line({ saleUnitPrice: '110' })], discountAmount: '0' });
    input.marginWarnRate = 0.3;
    input.marginWarnSource = 'project_type';
    const r1 = runRiskCheck(input).find((x) => x.code === 'R1_MARGIN_LOW')!;
    expect(r1.detail).toContain('本项目类型的');
  });

  it('R2 手填成本行 → warning 并给出行号', () => {
    const input = baseInput();
    input.lines = [{ ...input.lines[0]!, costSource: 'manual' }];
    const r2 = runRiskCheck(input).find((x) => x.code === 'R2_MANUAL_COST')!;
    expect(r2.level).toBe('warning');
    expect(r2.lineIndexes).toEqual([1]);
  });

  it('R4 负毛利 → warning，绝不阻断出单（TC-7.14 断言 2xx 不是 4xx）', () => {
    const input = baseInput();
    input.totals = calcQuote({ lines: [line({ saleUnitPrice: '80' })], discountAmount: '0' });
    const f = runRiskCheck(input);
    expect(f.find((x) => x.code === 'R4_NEGATIVE_PROFIT')?.level).toBe('warning');
    expect(riskLevelOf(f).blocked).toBe(false);
  });

  it('R7 价格在活动日期前失效 → warning（事后才炸的那一类）', () => {
    const input = baseInput();
    input.lines = [{ ...input.lines[0]!, priceEffectiveTo: '2026-11-30' }];
    const r7 = runRiskCheck(input).find((x) => x.code === 'R7_PRICE_EXPIRES_BEFORE_EVENT');
    expect(r7).toBeDefined();
    expect(r7!.level).toBe('warning');
  });

  it('客户名为空 → 唯一 blocker', () => {
    const input = baseInput();
    input.customerName = '';
    const r = riskLevelOf(runRiskCheck(input));
    expect(r.blocked).toBe(true);
    expect(r.blockerCount).toBe(1);
  });
});

describe('permissions — 分层开放（客户选定方案 c）', () => {
  it('member 能新建价，不能覆盖已有价', () => {
    expect(canCreatePrice('member')).toBe(true);
    expect(canOverridePrice('member')).toBe(false);
  });

  it('admin 两者都能', () => {
    expect(canCreatePrice('admin')).toBe(true);
    expect(canOverridePrice('admin')).toBe(true);
  });

  it('member 屏幕能看成本，但不能导出含成本文件', () => {
    expect(canExportInternal('member')).toBe(false);
    expect(canExportInternal('admin')).toBe(true);
  });
});
