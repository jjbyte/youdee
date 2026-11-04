'use client';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '@/lib/format';
import { IconError, IconSearch } from '@/components/icons';

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  aside,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="flex items-baseline justify-between gap-[var(--space-3)]">
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="t-danger">*</span> : null}
        </label>
        {aside}
      </div>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? (
        <div className="field-error" role="alert">
          <IconError size={16} />
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('input', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('select', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx('textarea', className)} />;
}

/** 页面搜索框：`/` 聚焦（由 useHotkey 绑定） */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputRef,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <div className={cx('search', className)}>
      <IconSearch size={16} />
      <input
        ref={inputRef}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
