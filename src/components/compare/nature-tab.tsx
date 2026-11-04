'use client';
import { useRef } from 'react';
import { formatMoney } from '@/lib/format';

export interface NatureSegment {
  /** 分组唯一键（nature::mode） */
  key: string;
  label: string;
  /** 组内可比的价数（不是行数——不可比的行不算「能比」） */
  comparableCount: number;
  /** 组内全部行数（含不可比、含失效） */
  totalCount: number;
  /** 组内最低价（比价基准单位）；无可比价时为 null，**绝不编一个出来** */
  lowest: number | null;
  /** 最低价后缀，如 `/㎡` */
  lowestUnit: string;
  /** 该组不能比的整体原因（MIXED_BASIS / ONLY_OTHER_BASIS / NO_COMPARABLE_UNIT） */
  blocked: boolean;
}

/**
 * 交易性质 Tab（§D.1C）。
 *
 * 这个组件存在的唯一理由是**防亏损**：LED 屏买断 ¥8,000 / 租赁 ¥500 一天，
 * 混在一列标「最低 ¥500」会让报价员按租价报一个需要买断的活动。
 * 所以：只有一种性质时**整条不渲染**，省下 40px；有两种就必须分开，且摘要条跟随它。
 *
 * 位置上它必须在摘要条**之上**——摘要条讲的是「当前这个性质里谁最便宜」。
 */
export function NatureTab({
  segments,
  value,
  onChange,
  ariaLabel = '交易性质',
}: {
  segments: NatureSegment[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function move(next: number) {
    const clamped = Math.max(0, Math.min(segments.length - 1, next));
    const seg = segments[clamped];
    if (!seg) return;
    onChange(seg.key);
    refs.current[clamped]?.focus();
  }

  return (
    <div className="nature-tabs" role="tablist" aria-label={ariaLabel}>
      {segments.map((s, i) => {
        const selected = s.key === value;
        return (
          <button
            key={s.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`nature-tab-${s.key}`}
            aria-selected={selected}
            aria-controls={`nature-panel-${s.key}`}
            tabIndex={selected ? 0 : -1}
            className="nature-tab"
            onClick={() => onChange(s.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(i + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(i - 1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                move(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                move(segments.length - 1);
              }
            }}
          >
            <span>{s.label}</span>
            <span className="nature-tab__count">{s.totalCount === 0 ? '没有能用的价' : `${s.totalCount} 家`}</span>
            <span className="nature-tab__low">
              {s.comparableCount >= 2 && s.lowest
                ? `最低 ${formatMoney(s.lowest, { symbol: true, decimals: 2 })}${s.lowestUnit}`
                : s.comparableCount === 1
                  ? '只有 1 家'
                  : s.blocked
                    ? '口径不一致'
                    : '没有能用的价'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
