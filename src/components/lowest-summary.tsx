'use client';
import type { LowestSummary, ItemType } from '@/lib/types';
import { formatMoney, cx } from '@/lib/format';
import { groupLabel } from '@/lib/labels';

/**
 * 最低价摘要（多行渲染，唯一实现，5 处共用）：
 * 物料库列表 / 人员库列表 / 搜索结果 / 报价单选品抽屉 / 工作台常用物料 chips。
 *
 * 铁律（§C.3 / §F.23）：is_multi_group = true 必须逐组出多行，
 * **禁止取 groups[0] 冒充最低价**。列表页没有 Tab 兜底，看到「最低 ¥380」
 * 后面跟着一个卖 ¥8,000 的买断价，就是全站最容易造成错单的一格。
 * 也不允许把两种性质相加。
 */
export function LowestSummaryView({
  summary,
  itemType,
  unitName,
  maxRows = 2,
  className,
}: {
  summary: LowestSummary | null | undefined;
  itemType: ItemType;
  /** base_unit_name，用于 unitCode 缺失时兜底 */
  unitName?: string | null;
  maxRows?: number;
  className?: string;
}) {
  const groups = (summary?.groups ?? []).filter((g) => g.groupLowest !== null && g.groupLowest !== undefined);

  if (groups.length === 0) {
    return (
      <div className={cx('lowest-lines', className)}>
        <span className="lowest-line" style={{ color: 'var(--table-num-muted)' }}>
          —
        </span>
        <span className="lowest-line" style={{ color: 'var(--fg-meta)' }}>
          未报价
        </span>
      </div>
    );
  }

  // 单组：只出金额（并列时由调用方传 tieCount 才显示 ×2，没有就不编）
  if (!summary?.isMultiGroup && groups.length === 1) {
    const g = groups[0]!;
    return (
      <div className={cx('lowest-lines', className)}>
        <b
          className="num"
          style={{ color: 'var(--success)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--text-sm)' }}
          aria-label={`最低 ${formatMoney(g.groupLowest)} 元每${g.unitCode || unitName || ''}`}
        >
          {formatMoney(g.groupLowest, { symbol: true })}
        </b>
      </div>
    );
  }

  const shown = groups.slice(0, maxRows);
  const rest = groups.length - shown.length;
  return (
    <div className={cx('lowest-lines', className)}>
      {shown.map((g, i) => (
        <span className="lowest-line" key={`${g.pricingNature}-${g.pricingMode ?? ''}-${i}`}>
          {itemType === 'personnel' ? '' : `${groupLabel(g.pricingNature, g.pricingMode, itemType)} `}
          <b>{formatMoney(g.groupLowest, { symbol: true })}</b>
          {g.unitCode ? `/${g.unitCode}` : ''}
        </span>
      ))}
      {rest > 0 ? <span className="lowest-line t-3">还有 {rest} 种</span> : null}
    </div>
  );
}
