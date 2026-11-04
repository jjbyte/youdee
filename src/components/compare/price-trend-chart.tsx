'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, errorMessage } from '@/lib/api';
import { addDaysISO, cx, formatDate, formatMoney, todayISO } from '@/lib/format';
import { unitLabel } from '@/lib/labels';
import type { PriceTrend } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/states';
import { Segmented } from '@/components/ui/segmented';
import { IconRefresh } from '@/components/icons';
import { DASHES, SERIES_COLORS, buildStepRows, fmtTick } from './trend-data';
import { TrendSkeleton } from './trend-skeleton';

type Range = '3m' | '6m' | '12m' | 'all';

/**
 * 完整趋势（§D.3，400px 抽屉里）：多供应商对比线 + 区间切换 + 可展开数据表。
 *
 * 用 `type="stepAfter"` 而不是线性插值：**价格是分段常数**，
 * 插值会在两次改价之间画出「中间价位」这种根本不存在的价格。一张会撒谎的图比没有图更糟。
 *
 * 图例必须能关（否则 5 条线看不清）；线条不靠颜色单独区分——不同 dasharray 给色盲用户。
 */
export function PriceTrendFull({
  itemId,
  itemName,
  pricingNature,
  unitCode,
  unitName,
}: {
  itemId: string;
  itemName: string;
  pricingNature?: string;
  unitCode: string;
  unitName?: string | null;
}) {
  const [range, setRange] = useState<Range>('12m');
  const [trend, setTrend] = useState<PriceTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [showTable, setShowTable] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const days = range === '3m' ? 92 : range === '6m' ? 183 : range === '12m' ? 365 : 3650;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .priceTrend(itemId, { from: addDaysISO(todayISO(), -days), to: todayISO(), pricingNature })
      .then((t) => {
        if (!alive) return;
        setTrend(t);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [itemId, pricingNature, days, reloadKey]);

  // 最多 5 条线：超过 5 条人眼无法区分
  const shown = (trend?.series ?? []).slice(0, 5);
  const built = useMemo(
    () => buildStepRows(shown.map((s) => ({ key: s.supplierId, points: s.points }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trend],
  );
  const unit = unitLabel(unitCode, unitName);
  const totalPoints = shown.reduce((acc, s) => acc + s.points.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-[var(--space-3)] mb-[var(--space-3)]">
        <span className="t-xs t-3">
          {itemName} · 基准单位 {unit} · 阶梯线（价格是分段常数，不做插值）
        </span>
        <Segmented<Range>
          ariaLabel="趋势区间"
          size="sm"
          value={range}
          options={[
            { value: '3m', label: '3 月' },
            { value: '6m', label: '6 月' },
            { value: '12m', label: '12 月' },
            { value: 'all', label: '全部' },
          ]}
          onChange={setRange}
        />
      </div>

      {loading ? <TrendSkeleton height={260} /> : null}
      {error ? (
        <Note tone="danger">
          {error}{' '}
          <button type="button" className="btn btn--link" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
        </Note>
      ) : null}

      {!loading && !error && totalPoints < 2 ? (
        <div className="state" style={{ padding: 'var(--space-6) 0' }}>
          <div className="state__title">只有 1 次记录，攒够 2 次才能画趋势。</div>
          <div className="state__body">改一次价、或者核一次价，就会多一个点。</div>
        </div>
      ) : null}

      {!loading && !error && totalPoints >= 2 ? (
        <>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={built.rows} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={fmtTick}
                  tick={{ fontSize: 11, fill: 'var(--fg-3)' }}
                  stroke="var(--border)"
                />
                <YAxis
                  domain={built.domain}
                  tickFormatter={(v) => `¥${Number(v).toFixed(0)}`}
                  tick={{ fontSize: 11, fill: 'var(--fg-3)' }}
                  stroke="var(--border)"
                  width={56}
                />
                <Tooltip
                  labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString())}
                  formatter={(v, name) => {
                    const s = shown.find((x) => x.supplierId === name);
                    return [
                      `${formatMoney(v as number, { symbol: true })} / ${unit}`,
                      s?.supplierName ?? String(name),
                    ];
                  }}
                  contentStyle={{
                    fontSize: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface)',
                  }}
                />
                {built.latest !== null ? (
                  <ReferenceLine
                    y={built.latest}
                    stroke="var(--chart-reference)"
                    strokeDasharray="3 3"
                    label={{
                      value: `当前基准价 ${formatMoney(built.latest, { symbol: true })}`,
                      position: 'insideTopRight',
                      fontSize: 11,
                      fill: 'var(--fg-3)',
                    }}
                  />
                ) : null}
                {shown.map((s, i) => (
                  <Line
                    key={s.supplierId}
                    type="stepAfter"
                    dataKey={s.supplierId}
                    name={s.supplierId}
                    hide={!!hidden[s.supplierId]}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={i === 0 ? 2.5 : 2}
                    strokeDasharray={DASHES[i % DASHES.length]}
                    dot={{ r: 3, strokeWidth: 0, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-[var(--space-2)] mt-[var(--space-3)]">
            {shown.map((s, i) => (
              <button
                key={s.supplierId}
                type="button"
                className="chip"
                aria-pressed={!hidden[s.supplierId]}
                onClick={() => setHidden((h) => ({ ...h, [s.supplierId]: !h[s.supplierId] }))}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 2,
                    background: SERIES_COLORS[i % SERIES_COLORS.length],
                    display: 'inline-block',
                  }}
                />
                {s.supplierName}
              </button>
            ))}
            <button type="button" className="btn btn--link ml-auto" onClick={() => setShowTable((v) => !v)}>
              {showTable ? '收起数据表' : '查看数据表'}
            </button>
          </div>

          {/* 图表的等价数据表：色盲用户 / 需要抄数的人必须能读 */}
          <table className={cx('tbl mt-[var(--space-3)]', !showTable && 'sr-only')}>
            <caption className="sr-only">价格趋势数据（{unit}）</caption>
            <thead>
              <tr>
                <th scope="col">生效日</th>
                {shown.map((s) => (
                  <th scope="col" className="ta-r" key={s.supplierId}>
                    {s.supplierName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {built.rows.map((r) => (
                <tr key={String(r.d)}>
                  <td>{String(r.d)}</td>
                  {shown.map((s) => {
                    const v = r[s.supplierId];
                    return (
                      <td className="ta-r num" key={s.supplierId}>
                        {typeof v === 'number' ? formatMoney(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

/** 「记录一次新价格」——趋势空态里唯一的出路，不能只写一句"没有数据"就完事 */
export function TrendRecordButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" icon={<IconRefresh size={16} />} onClick={onClick}>
      记录一次新价格
    </Button>
  );
}
