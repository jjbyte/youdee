'use client';
import { useRef, useState } from 'react';
import { formatQty, parseLooseNumber } from '@/lib/format';
import { Segmented } from '@/components/ui/segmented';

/**
 * 数量档切换器（§D.1B / PRD §7.2）。
 *
 * 铁律：**切档不发请求**。接口把每家全部阶梯整组返回，这里只按 qty 本地命中，
 * 否则首屏 1.5s 目标会被这一个高频交互打穿。
 *
 * 键盘：← → 切档（分段控件负责）；直接敲数字跳进自定义框；Enter 确认；Esc 退出回档位。
 */
export function QtyTierSwitch({
  qty,
  options,
  unitCode,
  unitName,
  onChange,
  children,
}: {
  qty: number;
  options: number[];
  unitCode: string;
  unitName?: string | null;
  onChange: (qty: number) => void;
  /** 口径切换 / 视图切换放在同一条工具栏的最右侧（§C.4 线框图） */
  children?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const unit = unitName || unitCode || '';

  const isPreset = options.includes(qty);

  function commit(raw: string) {
    const parsed = parseLooseNumber(raw);
    if (parsed.value === null) {
      // 清空 = 回到上一个有效档位，不出现「0 ㎡」
      setDraft('');
      setEditing(false);
      return;
    }
    const n = Number(parsed.value);
    if (!Number.isFinite(n) || n <= 0) {
      setDraft('');
      setEditing(false);
      return;
    }
    onChange(n);
    setDraft('');
    setEditing(false);
  }

  return (
    <div
      className="cmp-qtybar"
      onKeyDown={(e) => {
        // 敲数字直接跳进自定义输入框（报价员的手不想先找输入框）
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (/^[0-9]$/.test(e.key) && !editing) {
          e.preventDefault();
          setEditing(true);
          setDraft(e.key);
          inputRef.current?.focus();
        }
      }}
    >
      <span className="cmp-qtybar__label" id="qty-switch-label">
        数量
      </span>

      <Segmented
        ariaLabel="数量档位"
        value={isPreset ? String(qty) : '__custom__'}
        options={[
          ...options.map((o) => ({ value: String(o), label: `${formatQty(o)} ${unit}` })),
          ...(isPreset ? [] : [{ value: '__custom__', label: `${formatQty(qty)} ${unit}` }]),
        ]}
        onChange={(v) => {
          if (v === '__custom__') return;
          onChange(Number(v));
        }}
      />

      <label className="inline-flex items-center gap-[var(--space-2)]">
        <span className="cmp-qtybar__label">自定义</span>
        <input
          ref={inputRef}
          className="input num"
          style={{ width: 72, textAlign: 'right' }}
          inputMode="decimal"
          value={editing ? draft : isPreset ? '' : String(qty)}
          placeholder={isPreset ? '' : String(qty)}
          aria-label={`自定义数量，单位${unit}`}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) commit(draft);
            else setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft('');
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
        />
        <span className="cmp-qtybar__label">{unit}</span>
      </label>

      <span className="cmp-qtybar__now">
        按 <span className="num">{formatQty(qty)}</span> {unit} 计算
      </span>
      {children}
    </div>
  );
}
