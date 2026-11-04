'use client';
import { useEffect, type ReactNode } from 'react';
import { cx } from '@/lib/format';
import { IconCheck, IconClose, IconError, IconInfo } from '@/components/icons';
import { IconButton } from './button';

/** 右侧抽屉（录价、供应商详情共用）。Esc 关闭，遮罩点击关闭由调用方决定是否拦截 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width,
  closeOnScrim = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  closeOnScrim?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="scrim"
        aria-label="关闭抽屉"
        tabIndex={-1}
        onClick={() => closeOnScrim && onClose()}
      />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
      >
        <div className="drawer__head">
          <div className="min-w-0">
            <div className="drawer__title">{title}</div>
            {subtitle ? <div className="t-xs t-3 mt-[var(--space-1)]">{subtitle}</div> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </div>
        <div className="drawer__body">{children}</div>
        {footer ? <div className="drawer__foot">{footer}</div> : null}
      </aside>
    </>
  );
}

/** 居中弹窗（L1/L2 确认、发送前自检） */
export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <button type="button" className="scrim" aria-label="关闭" tabIndex={-1} onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className="modal__head">
          {icon}
          <div className="modal__title">{title}</div>
        </div>
        {children}
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </>
  );
}

/** 轻量 Toast：右下角，4 秒自动消失，不与底部汇总条抢位置 */
export function Toast({
  message,
  onClose,
  action,
  tone = 'success',
  duration = 4000,
}: {
  message: string | null;
  onClose: () => void;
  action?: { label: string; onClick: () => void };
  /** 文案说的是失败就画失败的图标——绿勾配「这次没成」是最刺眼的一种错 */
  tone?: 'success' | 'warn' | 'danger';
  /** 有撤销按钮时必须撑到文案承诺的秒数，否则「5 秒内可撤销」只真了 4 秒 */
  duration?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(id);
  }, [message, onClose, duration]);

  if (!message) return null;
  const Icon = tone === 'danger' ? IconError : tone === 'warn' ? IconInfo : IconCheck;
  const iconClass = tone === 'danger' ? 't-danger' : tone === 'warn' ? 't-warn' : 't-success';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed right-[var(--space-7)] bottom-[calc(var(--editor-footbar-h)+var(--space-7))] z-[var(--z-toast)]',
        'flex items-start gap-[var(--space-3)] max-w-[360px] px-[var(--space-4)] py-[var(--space-3)]',
        'bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-2)]',
      )}
    >
      <Icon size={16} className={cx(iconClass, 'mt-[2px]')} />
      <div className="t-sm flex-1">{message}</div>
      {action ? (
        <button type="button" className="btn--link btn" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <IconButton label="关掉这条提示" onClick={onClose} className="!w-[20px] !h-[20px]">
        <IconClose size={14} />
      </IconButton>
    </div>
  );
}
