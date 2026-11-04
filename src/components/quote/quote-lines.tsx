'use client';
import { formatMoney } from '@/lib/format';
import type { QuoteItem } from '@/lib/types';
import { IconChevronDown } from '@/components/icons';
import { QuoteLineRow, type LineFlags } from './quote-line-row';
import { groupLines } from './quote-shared';

/**
 * 明细表（§C.7）。13 列 / 1104px，1366 内容区 1102 → 刚好不横滚。
 *
 * 「为什么供应商和参考最低价做成一格两行」：多一列 88px 就 1192px，
 * 直接违反 PRD §11.4「1366 无横滚」的 P0 硬线；而"比最低贵 ¥3"这个结论
 * 离开供应商名就没有意义，挨着放才读得懂。**信息一个没少，横向像素一个没多。**
 */
export function QuoteLines({
  items,
  compact,
  locked,
  selectedIds,
  flagsOf,
  collapsed,
  onToggleCollapse,
  onToggleSelect,
  onPatch,
  onDuplicate,
  onDelete,
  onPickSupplier,
  onRecreatePrice,
  onAddLine,
  onCopyLastYear,
}: {
  items: QuoteItem[];
  compact: boolean;
  locked: boolean;
  selectedIds: Set<string>;
  flagsOf: (line: QuoteItem) => LineFlags;
  collapsed: Set<string>;
  onToggleCollapse: (key: string) => void;
  onToggleSelect: (id: string) => void;
  onPatch: (line: QuoteItem, changes: Record<string, unknown>) => void;
  onDuplicate: (line: QuoteItem) => void;
  onDelete: (line: QuoteItem) => void;
  onPickSupplier: (line: QuoteItem) => void;
  onRecreatePrice: (line: QuoteItem) => void;
  onAddLine: () => void;
  onCopyLastYear: () => void;
}) {
  const groups = groupLines(items);
  const hiddenCount = items.filter((l) => !l.isVisibleToCustomer).length;

  const colgroup = compact ? (
    <colgroup>
      <col style={{ width: 36 }} />
      <col style={{ width: 36 }} />
      <col />
      <col style={{ width: 52 }} />
      <col style={{ width: 60 }} />
      <col style={{ width: 92 }} />
      <col style={{ width: 88 }} />
      <col style={{ width: 96 }} />
      <col style={{ width: 64 }} />
      <col style={{ width: 72 }} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{ width: 36 }} />
      <col style={{ width: 36 }} />
      <col />
      <col style={{ width: 120 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 60 }} />
      <col style={{ width: 84 }} />
      <col style={{ width: 92 }} />
      <col style={{ width: 88 }} />
      <col style={{ width: 96 }} />
      <col style={{ width: 64 }} />
      <col style={{ width: 104 }} />
      <col style={{ width: 72 }} />
    </colgroup>
  );

  const cols = compact ? 10 : 13;

  return (
    <div>
      <table className="tbl" style={{ tableLayout: 'fixed', minWidth: compact ? 640 : 1104 }}>
        {colgroup}
        <thead>
          <tr>
            <th scope="col" className="ta-c" aria-label="全选" />
            <th scope="col" className="ta-r">
              #
            </th>
            <th scope="col">名称</th>
            {compact ? null : <th scope="col">规格 / 备注</th>}
            <th scope="col">单位</th>
            <th scope="col" className="ta-r">
              数量
            </th>
            {compact ? null : (
              <th scope="col" className="ta-r">
                成本单价
              </th>
            )}
            <th scope="col" className="ta-r">
              成本小计
            </th>
            <th scope="col" className="ta-r">
              对客价
            </th>
            <th scope="col" className="ta-r">
              对客小计
            </th>
            <th scope="col" className="ta-r">
              毛利率
            </th>
            {compact ? null : <th scope="col">供应商</th>}
            <th scope="col" className="ta-c">
              操作
            </th>
          </tr>
        </thead>

        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="group-row">
              <td colSpan={cols}>
                <button
                  type="button"
                  className="flex items-center gap-[var(--space-2)] w-full text-left"
                  aria-expanded={!collapsed.has(g.key)}
                  onClick={() => onToggleCollapse(g.key)}
                >
                  <IconChevronDown
                    size={16}
                    style={{
                      transform: collapsed.has(g.key) ? 'rotate(-90deg)' : undefined,
                      transition: 'transform 150ms',
                    }}
                  />
                  <span>{g.title}</span>
                  <span style={{ flex: 1 }} />
                  <span className="t-2xs t-3">
                    成本 <span className="num fw-med">{formatMoney(g.cost)}</span>
                    {'　'}对客 <span className="num fw-med">{formatMoney(g.price)}</span>
                  </span>
                </button>
              </td>
            </tr>

            {collapsed.has(g.key)
              ? null
              : g.lines.map((line) => (
                  <QuoteLineRow
                    key={line.id}
                    line={line}
                    index={items.findIndex((x) => x.id === line.id)}
                    compact={compact}
                    locked={locked}
                    selected={selectedIds.has(line.id)}
                    flags={flagsOf(line)}
                    onToggleSelect={() => onToggleSelect(line.id)}
                    onPatch={(changes) => onPatch(line, changes)}
                    onDuplicate={() => onDuplicate(line)}
                    onDelete={() => onDelete(line)}
                    onPickSupplier={() => onPickSupplier(line)}
                    onRecreatePrice={() => onRecreatePrice(line)}
                  />
                ))}
          </tbody>
        ))}
      </table>

      <div className="flex items-center gap-[var(--space-4)] mt-[var(--space-3)] px-[var(--space-2)]">
        <button type="button" className="btn btn--link" onClick={onAddLine} disabled={locked}>
          ＋ 添加行
        </button>
        <button type="button" className="btn btn--link" onClick={onCopyLastYear} disabled={locked}>
          ＋ 从上次方案复制
        </button>
        <span style={{ flex: 1 }} />
        {hiddenCount > 0 ? (
          <span className="t-2xs t-3">已隐藏客户版 {hiddenCount} 行</span>
        ) : null}
      </div>
    </div>
  );
}
