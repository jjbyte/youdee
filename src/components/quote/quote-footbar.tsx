'use client';
import { useState } from 'react';
import { cx, formatMoney, formatRate } from '@/lib/format';
import { PROJECT_TYPE_LABELS } from '@/lib/labels';
import type { QuoteDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { IconRisk } from '@/components/icons';

/**
 * 底部汇总条（§C.7）。
 *
 * 着色三档，**阈值只改颜色不改可用性**：
 *   ≥ 阈值 → 正常；0 ≤ 毛利率 < 阈值 → 琥珀 + 说出阈值来源；< 0 → 红（说"这单是亏的"）。
 * 红色只留给「这单在亏钱」和「价格已失效」两件事——红色用多了就不红了。
 *
 * 「生成报价单」禁用的唯一理由 = 还有行没填成本。
 * 不看 cost_source、不看软陈旧、不看毛利正负、不看是不是最低价。
 */
export function QuoteFootbar({
  quote,
  missingCount,
  staleCount,
  manualCount,
  issuing,
  locked,
  onDiscount,
  onIssue,
  floating = true,
}: {
  quote: QuoteDetail;
  missingCount: number;
  staleCount: number;
  manualCount: number;
  issuing: boolean;
  locked: boolean;
  onDiscount: (amount: string) => void;
  onIssue: () => void;
  /** true = 挂在 .editor 之外，自己吸底并补边框 */
  floating?: boolean;
}) {
  const [discountDraft, setDiscountDraft] = useState(quote.discountAmount ?? '0');
  const margin = quote.marginRate === null ? null : Number(quote.marginRate);
  const warnRate = quote.warnRateUsed ? Number(quote.warnRateUsed) : null;

  const tone: 'normal' | 'warn' | 'danger' =
    margin === null ? 'normal' : margin < 0 ? 'danger' : warnRate !== null && margin < warnRate ? 'warn' : 'normal';

  const belowText =
    warnRate === null
      ? ''
      : quote.warnRateSource === 'project_type' && quote.projectType
        ? `整单毛利率 ${formatRate(quote.marginRate)}，低于「${PROJECT_TYPE_LABELS[quote.projectType]}」的 ${(warnRate * 100).toFixed(0)}%`
        : `整单毛利率 ${formatRate(quote.marginRate)}，低于默认的 ${(warnRate * 100).toFixed(0)}%`;

  const grossBefore = Number(quote.totalPrice) + Number(quote.discountAmount ?? 0);
  const discounted = Number(quote.discountAmount ?? 0) > 0;

  return (
    <div className={cx('editor__footbar', floating && 'editor__footbar--floating')} data-tone={tone === 'normal' ? undefined : tone}>
      <span className="t-sm t-3">
        <span className="num fw-med">{quote.itemCount}</span> 项
      </span>

      <span className="t-sm t-3">
        成本 <span className="num fw-med">{formatMoney(quote.totalCost, { symbol: true })}</span>
      </span>

      <span className="t-sm t-3">
        对客 <span className="num fw-med">{formatMoney(quote.totalPrice, { symbol: true })}</span>
      </span>

      <label className="inline-flex items-center gap-[var(--space-1)] t-sm t-3">
        优惠
        <input
          className="input num"
          style={{ width: 88, textAlign: 'right' }}
          inputMode="decimal"
          value={discountDraft}
          disabled={locked}
          aria-label="整单优惠金额"
          onChange={(e) => setDiscountDraft(e.target.value)}
          onBlur={() => {
            if (discountDraft !== (quote.discountAmount ?? '0')) onDiscount(discountDraft || '0');
          }}
        />
      </label>

      <span className="t-sm t-3">
        毛利 <span className="num fw-med">{formatMoney(quote.totalProfit, { symbol: true })}</span>
      </span>

      <span className="inline-flex items-baseline gap-[var(--space-2)]">
        <span className="t-sm t-3">毛利率</span>
        <span
          className={cx(
            'num',
            't-xl',
            tone === 'danger' ? 't-danger' : tone === 'warn' ? 't-warning' : 'fw-semi',
          )}
          style={{ fontSize: 22, fontWeight: 'var(--fw-semibold)' }}
        >
          {formatRate(quote.marginRate)}
        </span>
      </span>

      {quote.minLineMargin !== null ? (
        <span className="t-2xs t-3">
          最低行毛利率 <span className="num">{formatRate(quote.minLineMargin)}</span>
        </span>
      ) : null}

      <span className="spacer" />

      {discounted ? (
        <span className="t-2xs t-3">
          原 <span className="num">{formatMoney(grossBefore, { symbol: true })}</span> → 折后{' '}
          <span className="num">{formatMoney(quote.totalPrice, { symbol: true })}</span>（
          {grossBefore > 0 ? `-${((Number(quote.discountAmount) / grossBefore) * 100).toFixed(0)}%` : '—'}）
        </span>
      ) : null}

      {missingCount > 0 ? (
        <span className="inline-flex items-center gap-[var(--space-2)] t-sm t-danger">
          <IconRisk size={16} />
          {missingCount} 行还没有成本，填上就能出单
        </span>
      ) : (
        <>
          {tone === 'danger' ? (
            <span className="inline-flex items-center gap-[var(--space-2)] t-sm t-danger">
              <IconRisk size={16} />
              这单是亏的（{formatRate(quote.marginRate)}）。确认要出？
            </span>
          ) : tone === 'warn' ? (
            <span className="inline-flex items-center gap-[var(--space-2)] t-sm t-warning">
              <IconRisk size={16} />
              {belowText}
              <span className="t-2xs t-3">{quote.warnRateSource === 'project_type' ? '按项目类型' : '默认'}</span>
            </span>
          ) : null}
          {staleCount > 0 ? (
            <span className="inline-flex items-center gap-[var(--space-2)] t-sm t-warning">
              <IconRisk size={16} />
              {staleCount} 行用的是 90 天前的价，确认无误可出单
            </span>
          ) : null}
          {manualCount > 0 ? <span className="t-2xs t-3">{manualCount} 行手填</span> : null}
        </>
      )}

      <Button
        variant="primary"
        loading={issuing}
        disabled={locked || missingCount > 0}
        title={missingCount > 0 ? `还差 ${missingCount} 行没填成本` : undefined}
        onClick={onIssue}
      >
        生成报价单
      </Button>
    </div>
  );
}
