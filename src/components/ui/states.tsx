'use client';
import type { ReactNode } from 'react';
import { cx } from '@/lib/format';
import { IconError, IconInfo, IconLoading, IconSuccess, IconRisk } from '@/components/icons';
import { Button } from './button';

/**
 * 空 / 加载 / 错误态（§D.5）。
 * 文案一律由调用方从设计文档抄真实业务句子，禁止"暂无数据"。
 */
export function EmptyState({
  title,
  body,
  icon,
  primary,
  secondary,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
  primary?: { label: string; onClick?: () => void; href?: string };
  secondary?: { label: string; onClick?: () => void; href?: string };
}) {
  return (
    <div className="state">
      {icon ? <div className="state__icon">{icon}</div> : null}
      <div className="state__title">{title}</div>
      {body ? <div className="state__body">{body}</div> : null}
      {primary || secondary ? (
        <div className="state__actions">
          {primary ? (
            primary.href ? (
              <a className="btn btn--primary" href={primary.href}>
                {primary.label}
              </a>
            ) : (
              <Button variant="primary" onClick={primary.onClick}>
                {primary.label}
              </Button>
            )
          ) : null}
          {secondary ? (
            secondary.href ? (
              <a className="btn btn--secondary" href={secondary.href}>
                {secondary.label}
              </a>
            ) : (
              <Button variant="secondary" onClick={secondary.onClick}>
                {secondary.label}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = '重试',
  children,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon">
        <IconError size={24} />
      </div>
      <div className="state__title">{message}</div>
      {children}
      {onRetry ? (
        <div className="state__actions">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 表格骨架：行高与真实行一致，避免 CLS（§D.5） */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton-row" style={{ height: 'var(--table-header-h)' }}>
        <div className="skeleton skeleton-bar" style={{ width: '40%' }} />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-row" key={r}>
          <div
            className="skeleton skeleton-bar"
            style={{ width: `${30 + ((r * 13) % 45)}%`, marginRight: 'var(--space-3)' }}
          />
          {Array.from({ length: Math.max(1, cols - 1) }).map((__, c) => (
            <div
              className="skeleton skeleton-bar"
              key={c}
              style={{ width: '12%', marginRight: 'var(--space-3)' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function InlineLoading({ label }: { label: string }) {
  return (
    <span className="t-sm t-3 inline-flex items-center gap-[var(--space-2)]" role="status">
      <IconLoading size={16} className="animate-spin" />
      {label}
    </span>
  );
}

export type NoteTone = 'warn' | 'danger' | 'success' | 'info' | 'neutral';

const NOTE_TONE: Record<NoteTone, string> = {
  warn: 'note--warn',
  danger: 'note--danger',
  success: 'note--success',
  info: 'note--info',
  neutral: '',
};

const NOTE_ICON: Record<NoteTone, ReactNode> = {
  warn: <IconRisk size={16} />,
  danger: <IconError size={16} />,
  success: <IconSuccess size={16} />,
  info: <IconInfo size={16} />,
  neutral: <IconInfo size={16} />,
};

/** 行内提示条（不用 Modal，不打断） */
export function Note({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: NoteTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('note', NOTE_TONE[tone], className)} role={tone === 'danger' ? 'alert' : undefined}>
      {NOTE_ICON[tone]}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
