'use client';

/** 趋势骨架：12 个等高竖条（不是转圈）——它要占的是一条折线的位置，转圈会误导「这里有个控件」。 */
export function TrendSkeleton({ height }: { height: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="趋势加载中"
      style={{ height, display: 'flex', alignItems: 'flex-end', gap: 4, opacity: 0.5 }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          style={{ flex: 1, height: `${30 + ((i * 17) % 60)}%`, background: 'var(--border)', borderRadius: 2 }}
        />
      ))}
    </div>
  );
}
