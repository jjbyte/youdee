'use client';
import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/format';
import type { QuoteItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { QuoteLines } from './quote-lines';
import type { LineFlags } from './quote-line-row';

/**
 * 明细面板：工具栏 + 表格 + 勾选条。
 *
 * 三个视图状态（密度 / 勾选 / 分组折叠）都留在这一层——它们是"这个表怎么显示"，
 * 不是"这张单是什么"。页面只关心后者，不然每次调整列宽都要动单据逻辑。
 *
 * 1366 以下默认精简档：13 列要 1104px，1366 减去侧栏只剩 1102，
 * 差 2px 也要横滚，而横滚会让"合计"那几列永远看不见——看不见就等于没有。
 */
export function QuoteLinesPanel({
  items,
  locked,
  flagsOf,
  onPatch,
  onDuplicate,
  onDelete,
  onPickSupplier,
  onRecreatePrice,
  onAddLine,
  onCopyLastYear,
  onBulkDelete,
}: {
  items: QuoteItem[];
  locked: boolean;
  flagsOf: (line: QuoteItem) => LineFlags;
  onPatch: (line: QuoteItem, changes: Record<string, unknown>) => void;
  onDuplicate: (line: QuoteItem) => void;
  onDelete: (line: QuoteItem) => void;
  onPickSupplier: (line: QuoteItem) => void;
  onRecreatePrice: (line: QuoteItem) => void;
  onAddLine: () => void;
  onCopyLastYear: () => void;
  onBulkDelete: (ids: string[]) => void;
}) {
  const [compact, setCompact] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // 完整档 13 列要 1104px，而 1440 的屏扣掉侧栏 224 + 选品栏 320 + 边距只剩 848——
    // 摆不下就会横滚，而横滚把"毛利率 / 供应商 / 操作"三列推出视口，看不见等于没有。
    // 所以阈值从 1366 提到 1520：1440 及以下默认精简档（成本单价列不精简，见 row 注释）。
    setCompact(window.innerWidth < 1520);
  }, []);

  // 行被删掉后，勾选里会留下不存在的 id——批量删的时候就会去删一个已经没了的行
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(items.map((l) => l.id));
      const next = new Set(Array.from(prev).filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  return (
    <div className="editor__body">
      <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-2)]">
        <span className="t-sm fw-semi">明细</span>
        <div className="flex items-center gap-[var(--space-3)]">
          {/* 没人知道的快捷键等于不存在——写在按钮旁边，用户扫一眼就能用上 */}
          <span className="t-2xs t-3">
            <kbd className="kbd">⌘D</kbd> 复制 ·<kbd className="kbd">Alt ↑↓</kbd> 移行 ·<kbd className="kbd">Del</kbd>{' '}
            删行 ·<kbd className="kbd">⌘Enter</kbd> 出单
          </span>
          <Button size="sm" variant={compact ? 'secondary' : 'ghost'} onClick={() => setCompact(true)} aria-pressed={compact}>
            精简
          </Button>
          <Button size="sm" variant={compact ? 'ghost' : 'secondary'} onClick={() => setCompact(false)} aria-pressed={!compact}>
            完整
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="state">
          <div className="state__title">单子还是空的。</div>
          <div className="state__body">左边搜「背景板」试试，勾上点「攒进报价单」。</div>
        </div>
      ) : (
        <QuoteLines
          items={items}
          compact={compact}
          locked={locked}
          selectedIds={selectedIds}
          flagsOf={flagsOf}
          collapsed={collapsed}
          onToggleCollapse={(k) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              return next;
            })
          }
          onToggleSelect={(lineId) =>
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(lineId)) next.delete(lineId);
              else next.add(lineId);
              return next;
            })
          }
          onPatch={onPatch}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onPickSupplier={onPickSupplier}
          onRecreatePrice={onRecreatePrice}
          onAddLine={onAddLine}
          onCopyLastYear={onCopyLastYear}
        />
      )}

      {/* 勾选条贴在吸底条**上面**——它解释的是"下一步"，不是"已经发生的事"。
          放到吸底条下面就会被吸底条盖住，等于没做。 */}
      {selectedIds.size > 0 ? (
        <div className="note flex items-center gap-[var(--space-3)] flex-wrap mx-[var(--space-4)] mt-[var(--space-3)]">
          <span className="t-sm">
            已勾选 <span className="num fw-med">{selectedIds.size}</span> 行
          </span>
          <span className="t-2xs t-3">
            合计成本{' '}
            <span className="num">
              {formatMoney(
                items.filter((l) => selectedIds.has(l.id)).reduce((a, l) => a + Number(l.lineCost ?? 0), 0),
                { symbol: true },
              )}
            </span>
          </span>
          <button
            type="button"
            className="btn btn--link"
            disabled={locked}
            onClick={() => {
              onBulkDelete(Array.from(selectedIds));
              setSelectedIds(new Set());
            }}
          >
            批量删掉
          </button>
          <button type="button" className="btn btn--link" onClick={() => setSelectedIds(new Set())}>
            取消勾选
          </button>
        </div>
      ) : null}
    </div>
  );
}
