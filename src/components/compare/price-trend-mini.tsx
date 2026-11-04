'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { addDaysISO, formatDate, formatMoney, todayISO } from '@/lib/format';
import { unitLabel } from '@/lib/labels';
import type { PriceTrend } from '@/lib/types';
import { IconLowest, IconRise } from '@/components/icons';
import { buildStepRows } from './trend-data';
import { TrendSkeleton } from './trend-skeleton';

/**
 * 卡片底部 120px 迷你折线（§D.1.1）。**展开时才请求**——首屏两段式：
 * 比价接口只出价格与阶梯 → 卡片立刻可读可点 → 图在展开时才来。
 *
 * 趋势失败不影响价格可用：降级成「趋势没加载出来 · 重试」，不弹错误。
 * 价格是主功能，趋势是附加，附加功能失败不许污染主功能。
 */
export function PriceTrendMini({
  itemId,
  pricingNature,
  supplierId,
  unitCode,
  height = 120,
}: {
  itemId: string;
  pricingNature?: string;
  supplierId: string;
  unitCode: string;
  height?: number;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [trend, setTrend] = useState<PriceTrend | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setState('loading');
    api
      .priceTrend(itemId, { from: addDaysISO(todayISO(), -365), to: todayISO(), pricingNature })
      .then((t) => {
        if (!alive) return;
        setTrend(t);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [itemId, pricingNature]);

  useEffect(() => load(), [load]);

  const series = trend?.series.find((s) => s.supplierId === supplierId);
  const built = useMemo(() => buildStepRows([{ key: 'v', points: series?.points ?? [] }]), [series]);

  const change = useMemo(() => {
    const pts = series?.points ?? [];
    if (pts.length < 2) return null;
    const first = Number(pts[0]!.baseUnitPrice);
    const last = Number(pts[pts.length - 1]!.baseUnitPrice);
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
    return (last - first) / first;
  }, [series]);

  if (state === 'loading') return <TrendSkeleton height={height} />;

  if (state === 'error') {
    return (
      <div className="t-2xs t-3 flex items-center gap-[var(--space-1)]" style={{ height }}>
        趋势没加载出来 ·
        <button type="button" className="btn btn--link" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  const points = series?.points ?? [];
  if (points.length < 2) {
    return (
      <div className="t-2xs t-3 flex flex-col justify-center gap-[var(--space-1)]" style={{ height }}>
        <span>只有 {points.length} 次记录，攒够 2 次才能画趋势。</span>
      </div>
    );
  }

  return (
    <div style={{ height }} aria-label={`${unitLabel(unitCode)} 价格走势，${points.length} 次改价记录`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={built.rows} margin={{ top: 8, right: 2, bottom: 0, left: 2 }}>
          <YAxis hide domain={built.domain} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
          <Tooltip
            labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString())}
            formatter={(v) => [formatMoney(v as number, { symbol: true }), '基准单价']}
            contentStyle={{
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
            }}
          />
          <Line
            type="stepAfter"
            dataKey="v"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      {change !== null && change !== 0 ? (
        <div
          className={`t-2xs flex items-center gap-[3px] ${change > 0 ? 't-danger' : 't-success'}`}
          title="近一年这家在这个品上的改价幅度"
        >
          {change > 0 ? <IconRise size={16} /> : <IconLowest size={16} />}
          {Math.abs(change * 100).toFixed(1)}%
        </div>
      ) : null}
    </div>
  );
}
