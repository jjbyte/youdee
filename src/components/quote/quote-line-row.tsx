'use client';
import { useState } from 'react';
import { cx, formatMoney, formatRate, parseLooseNumber } from '@/lib/format';
import type { QuoteItem } from '@/lib/types';
import { IconButton } from '@/components/ui/button';
import { IconCopy, IconEyeOff, IconEyeOn, IconRisk, IconTrash } from '@/components/icons';

/** 单元格级可编辑输入（Enter 提交并下移、Esc 还原、Tab 右移） */
function CellInput({
  value,
  onCommit,
  ariaLabel,
  rowKey,
  field,
  align = 'right',
  placeholder,
  invalid,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  rowKey: string;
  field: string;
  align?: 'left' | 'right';
  placeholder?: string;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  function focusSibling(delta: number) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-cell="${field}"]`));
    const idx = nodes.findIndex((n) => n.dataset.row === rowKey);
    const next = nodes[idx + delta] as HTMLInputElement | undefined;
    next?.focus();
    next?.select();
  }

  return (
    <input
      className={cx('cell-input', align === 'right' && 'num')}
      data-cell={field}
      data-row={rowKey}
      value={shown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          focusSibling(1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value);
          setFocused(false);
          e.currentTarget.blur();
        } else if (e.key === 'Tab' && !e.shiftKey) {
          commit();
        }
      }}
    />
  );
}

export interface LineFlags {
  missingCost: boolean;
  staleDays?: number;
  overLowestAmount?: string;
  overLowestSupplier?: string | null;
  loss?: boolean;
  zeroPrice?: boolean;
}

/**
 * 一行明细（§C.7 明细表）。
 *
 * 三条不能错：
 *   ① 缺价行**红底 + 行首 alert + 成本格变输入框**，且阻断只发生在「没有成本数」——
 *      填完当场转正常，不刷新、不重存。
 *   ② 行上所有值都是**下单那一刻的快照**，不显示"这个价现在变了"。
 *      要看现状去比价页：单据是历史，比价页是现在，两者不能混在一张表里说话。
 *   ③ 供应商一格两行：上行供应商名，下行「最低 ¥25.00 · 金桥桁架厂」快照，
 *      贵了就转红写「高 ¥3.00」。省 88px 是因为 1366 不能横滚，不是因为不重要。
 */
export function QuoteLineRow({
  line,
  index,
  compact,
  locked,
  selected,
  flags,
  onToggleSelect,
  onPatch,
  onDuplicate,
  onDelete,
  onPickSupplier,
  onRecreatePrice,
}: {
  line: QuoteItem;
  index: number;
  compact: boolean;
  locked: boolean;
  selected: boolean;
  flags: LineFlags;
  onToggleSelect: () => void;
  onPatch: (changes: Record<string, unknown>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPickSupplier: () => void;
  onRecreatePrice?: () => void;
}) {
  const unit = line.unitSnapshot || '—';
  const overLowest = flags.overLowestAmount && Number(flags.overLowestAmount) > 0;

  function numberCommit(field: 'qty' | 'costUnitPrice' | 'saleUnitPrice') {
    return (raw: string) => {
      const parsed = parseLooseNumber(raw);
      if (parsed.value === null) return;
      if (Number(parsed.value) <= 0) return;
      if (field === 'costUnitPrice') {
        // 手填成本 = cost_source 必须转 manual，否则这行的成本会被宣称"来自价格库"，
        // manual_cost_line_ratio 这个质量指标从此永久失真
        onPatch({ costUnitPrice: parsed.value, costSource: 'manual' });
      } else if (field === 'qty') {
        onPatch({ qty: parsed.value });
      } else {
        onPatch({ saleUnitPrice: parsed.value });
      }
    };
  }

  return (
    <tr
      className={cx(!line.isVisibleToCustomer && 'line-hidden', flags.missingCost && 'line-missing')}
      data-selected={selected || undefined}
      data-line-id={line.id}
    >
      <td className="ta-c">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`选择第 ${index + 1} 行 ${line.itemNameSnapshot}`}
          disabled={locked}
        />
      </td>
      <td className="ta-r num t-3">
        <span className="inline-flex items-center gap-[var(--space-1)]">
          {flags.missingCost ? <IconRisk size={16} className="t-danger" /> : null}
          {flags.loss ? <IconRisk size={16} className="t-danger" /> : null}
          {index + 1}
        </span>
      </td>
      <td>
        <div className="truncate" title={line.itemNameSnapshot}>
          {line.itemNameSnapshot}
        </div>
        <span className="cell-sub">
          {line.supplierNameSnapshot ?? '未指定供应商'}
          {line.remark ? ` · ${line.remark}` : ''}
        </span>
      </td>
      {compact ? null : (
        <td>
          <span className="truncate t-3 t-xs" title={line.specSnapshot ?? ''}>
            {line.specSnapshot || '—'}
          </span>
        </td>
      )}
      <td>
        <span className="t-xs">{unit}</span>
      </td>
      <td className="ta-r">
        <CellInput
          value={line.qty}
          rowKey={line.id}
          field="qty"
          ariaLabel={`第 ${index + 1} 行数量`}
          onCommit={numberCommit('qty')}
        />
      </td>
      {compact ? null : (
        <td className="ta-r">
          {flags.missingCost ? (
            <div className="flex flex-col items-end gap-[2px]">
              <CellInput
                value=""
                rowKey={line.id}
                field="costUnitPrice"
                ariaLabel={`第 ${index + 1} 行手填成本`}
                placeholder="手填成本"
                invalid
                onCommit={numberCommit('costUnitPrice')}
              />
              {onRecreatePrice ? (
                <button type="button" className="btn btn--link t-2xs" onClick={onRecreatePrice}>
                  按旧价重新录价
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="cell-btn"
              onClick={onPickSupplier}
              aria-label={`第 ${index + 1} 行成本 ${formatMoney(line.costUnitPrice)}，点这里换供应商`}
              title="点这里换供应商"
            >
              {formatMoney(line.costUnitPrice)}
              {line.costSource === 'manual' ? <span className="badge badge--manual ml-[var(--space-1)]">手填</span> : null}
              {flags.staleDays ? (
                <span className="badge badge--warn ml-[var(--space-1)]">{flags.staleDays} 天</span>
              ) : null}
            </button>
          )}
        </td>
      )}
      <td className="ta-r t-3 num">{formatMoney(line.lineCost)}</td>
      <td className="ta-r">
        <CellInput
          value={line.saleUnitPrice}
          rowKey={line.id}
          field="saleUnitPrice"
          ariaLabel={`第 ${index + 1} 行对客单价`}
          invalid={flags.zeroPrice}
          onCommit={numberCommit('saleUnitPrice')}
        />
      </td>
      <td className="ta-r num fw-med">{formatMoney(line.linePrice)}</td>
      <td className={cx('ta-r num', flags.loss && 't-danger')}>{formatRate(line.lineMargin)}</td>
      {compact ? null : (
        <td>
          <div className="truncate t-xs" title={line.supplierNameSnapshot ?? ''}>
            {line.supplierNameSnapshot ?? '—'}
          </div>
          {line.referenceLowestPrice ? (
            <span className={cx('cell-sub', overLowest && 't-danger')}>
              最低 {formatMoney(line.referenceLowestPrice)}
              {overLowest ? ` · 高 ${formatMoney(flags.overLowestAmount)}` : ''}
            </span>
          ) : null}
        </td>
      )}
      <td>
        <div className="flex items-center justify-center gap-[var(--space-1)]">
          <IconButton
            label={line.isVisibleToCustomer ? '不在客户版显示' : '在客户版显示'}
            onClick={() => onPatch({ isVisibleToCustomer: !line.isVisibleToCustomer })}
            disabled={locked}
            className="!w-[24px] !h-[24px]"
          >
            {line.isVisibleToCustomer ? <IconEyeOff size={16} /> : <IconEyeOn size={16} />}
          </IconButton>
          <IconButton label="复制这一行" onClick={onDuplicate} disabled={locked} className="!w-[24px] !h-[24px]">
            <IconCopy size={16} />
          </IconButton>
          <IconButton label="删掉这一行" onClick={onDelete} disabled={locked} className="!w-[24px] !h-[24px]">
            <IconTrash size={16} />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}
