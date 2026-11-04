import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

export type BadgeTone =
  | 'neutral'
  | 'lowest'
  | 'lowest-tie'
  | 'warn'
  | 'danger'
  | 'success'
  | 'info'
  | 'internal'
  | 'manual';

const TONE: Record<BadgeTone, string> = {
  neutral: 'badge--neutral',
  lowest: 'badge--lowest',
  'lowest-tie': 'badge--lowest-tie',
  warn: 'badge--warn',
  danger: 'badge--danger',
  success: 'badge--success',
  info: 'badge--info',
  internal: 'badge--internal',
  manual: 'badge--manual',
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
  md = false,
  title,
  className,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  md?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={cx('badge', TONE[tone], md && 'badge--md', className)}>
      {icon}
      {children}
    </span>
  );
}
