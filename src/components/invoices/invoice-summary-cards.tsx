'use client';
import type { InvoiceSummary } from '@/lib/types';
import { cx, formatDecimalString } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

/**
 * 统计条：**列表上方常显**，不做"点开才算"。
 *
 * 三条口径必须同时可见，否则合计会看起来像算错了：
 *   1. 金额只加**非空**的（缺金额的单独给张数）——写成 0 会让合计悄悄少算；
 *   2. 冲红记负数，直接参与求和，"含冲红 N 张"是让这个负数有解释；
 *   3. 命中的是**当前筛选条件**，不是全库。
 *
 * 金额一律按字符串渲染（formatDecimalString，不过 Number）——
 * 台账要拿去跟税局核对，1900.10 不能变成 1900.1。
 */
export function InvoiceSummaryCards({
  summary,
  loading,
  includeDeleted = false,
}: {
  summary: InvoiceSummary | null;
  loading: boolean;
  /**
   * 「删除状态 = 已删除」时置 true。
   *
   * 这时服务端的 summary 与列表**同口径**（已删的票也算进去了，逐条累加对得上）。
   * 数字没错，但它把一堆已经作废的票加在一起，对账时没有任何意义 ——
   * 所以不是改数字，也不是报警，而是把口径写到数字旁边。
   */
  includeDeleted?: boolean;
}) {
  const money = (v: string | null | undefined) =>
    summary ? formatDecimalString(v, { symbol: true }) : '—';
  const count = (v: number | null | undefined) =>
    summary && typeof v === 'number' ? `${v} 张` : '—';

  const redCount = summary?.redCount ?? 0;
  const missing = summary?.missingAmountCount ?? 0;

  return (
    <div className="panel" aria-busy={loading || undefined}>
      <div className="flex flex-wrap items-end gap-x-[var(--space-8)] gap-y-[var(--space-4)]">
        <Stat label="发票数量" value={count(summary?.count)} />
        <Stat label="金额合计（不含税）" value={money(summary?.sumAmount)} />
        <Stat label="税额合计" value={money(summary?.sumTaxAmount)} />
        <Stat label="价税合计" value={money(summary?.sumTotalAmount)} strong />
        <Stat
          label="待补金额"
          value={count(summary?.missingAmountCount)}
          tone={missing > 0 ? 'warn' : undefined}
          hint={missing > 0 ? '这几张票有金额没认出来，没算进合计' : undefined}
        />
        <Stat
          label="含冲红"
          value={summary ? count(redCount) : '—'}
          tone={redCount > 0 ? 'danger' : undefined}
          hint={redCount > 0 ? '冲红票按负数计入合计' : '这批里没有冲红票'}
        />
      </div>
      {includeDeleted ? (
        <p className="t-2xs mt-[var(--space-3)] flex items-start gap-[var(--space-2)] flex-wrap">
          <Badge tone="neutral">含已删除</Badge>
          <span className="t-3 flex-1 min-w-[200px]">
            上面的张数与合计把已删除的票也算进去了，只用来核对找回（比如恢复录错的那张），
            不是对账数字。算账请把「删除状态」切回「在用」。
          </span>
        </p>
      ) : null}
      <p className="t-2xs t-3 mt-[var(--space-3)]">
        合计 = 当前筛选范围内「金额非空」的那些票直接相加；冲红票记负数，已经在合计里抵掉。
        金额待补的票不进合计，所以张数和金额可能看起来对不上——那是有票还没认全。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
  tone,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'warn' | 'danger';
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-1)] min-w-[104px]" title={hint}>
      <span className="t-2xs t-3">{label}</span>
      <span
        className={cx(
          'tabular-nums',
          strong ? 't-md fw-semi' : 't-md',
          tone === 'warn' && 't-warning',
          tone === 'danger' && 't-danger',
          !tone && 't-2',
        )}
      >
        {value}
      </span>
    </div>
  );
}
