'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/format';
import { IconLoading } from '@/components/icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
  link: 'btn--link',
};
const SIZE: Record<Size, string> = { sm: 'btn--sm', md: '', lg: 'btn--lg' };

/** 按钮：覆盖 default / hover / focus / active / disabled / loading 六态 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('btn', VARIANT[variant], SIZE[size], block && 'w-full', className)}
    >
      {loading ? <IconLoading size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** 图标按钮必须带 aria-label（§E.6），命中区 28×28 */
export function IconButton({ label, children, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx('btn btn--icon', className)}
    >
      {children}
    </button>
  );
}
