/**
 * 趋势数据层：把多家 series 对齐到同一批日期，按「分段常数」取值。
 *
 * 价格是**事件驱动**的（改价才有一个点），所以 X 轴按数据点走，不强行等距。
 * 某家在某个日期之前没有价 → null，不是 0（0 会在图上画出一条贴着底的假线）。
 */
export const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
export const DASHES = ['0', '5 3', '2 3', '8 3 2 3', '1 4'];

export interface RawPoint {
  effectiveFrom: string;
  baseUnitPrice: string;
}

export function buildStepRows(series: Array<{ key: string; points: RawPoint[] }>) {
  const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.effectiveFrom)))).sort();
  const sorted = series.map((s) => ({
    key: s.key,
    points: [...s.points].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
  }));

  const rows = dates.map((d) => {
    const row: Record<string, number | string | null> = { d, t: Date.parse(`${d}T00:00:00`) };
    for (const s of sorted) {
      let v: number | null = null;
      for (const p of s.points) {
        if (p.effectiveFrom <= d) v = Number(p.baseUnitPrice);
        else break;
      }
      row[s.key] = v;
    }
    return row;
  });

  const values = rows.flatMap((r) =>
    Object.entries(r)
      .filter(([k]) => k !== 'd' && k !== 't')
      .map(([, v]) => v)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
  );
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const pad = max - min > 0 ? (max - min) * 0.15 : max * 0.15 || 1;

  return {
    rows,
    dates,
    domain: [Math.max(0, min - pad), max] as [number, number],
    latest: values.length ? values[values.length - 1]! : null,
  };
}

export function fmtTick(t: number): string {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
