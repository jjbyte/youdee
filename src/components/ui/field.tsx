'use client';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '@/lib/format';
import { IconError, IconEyeOff, IconEyeOn, IconSearch } from '@/components/icons';

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="t-danger">*</span> : null}
      </label>
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

/**
 * 密码框：眼睛图标贴在框内右侧。
 *
 * 图标表达的是「点了会发生什么」，不是「现在是什么状态」——和明细表里
 * 显示/隐藏那一列的眼睛同一条约定：藏着时给睁眼（点它露出来），
 * 露着时给闭眼（点它藏回去）。两者搞反是这类控件最常见的错。
 *
 * 按钮必须落在输入框边界之内，人才看得出这个开关管的就是这个框。
 */
export function PasswordInput({
  visible,
  onToggleVisible,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div className="input-affix">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={cx('input', className)}
      />
      <button
        type="button"
        className="input-affix__toggle"
        onClick={onToggleVisible}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        title={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <IconEyeOff size={16} /> : <IconEyeOn size={16} />}
      </button>
    </div>
  );
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
