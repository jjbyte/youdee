'use client';
import { cx } from '@/lib/format';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** 分段控件（含税口径、数量档、视图切换共用）。← → 切换在持焦时生效 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm';
}) {
  return (
    <div
      className={cx('seg', className)}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const idx = options.findIndex((o) => o.value === value);
        const next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        const target = options[next];
        if (target && !target.disabled) onChange(target.value);
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg-item"
          style={size === 'sm' ? { height: '28px', fontSize: 'var(--text-xs)' } : undefined}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
