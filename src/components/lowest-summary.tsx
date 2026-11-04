'use client';
import type { LowestSummary, ItemType } from '@/lib/types';
import { formatMoney, cx } from '@/lib/format';
import { groupLabel, unitLabel } from '@/lib/labels';

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
  hasPrices = false,
  maxRows = 2,
  className,
}: {
  summary: LowestSummary | null | undefined;
  itemType: ItemType;
  /** base_unit_name，用于 unitCode 缺失时兜底 */
  unitName?: string | null;
  /** 这家主体在库里有没有价（有价但没有本口径的价，和"从来没报过价"是两件事） */
  hasPrices?: boolean;
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
        {/* 「报价数 1 家」旁边写「未报价」是自相矛盾的：真正的情况是这一家有价，
            但那条价不是这个口径（含税单遇上只报不含税的供应商）。分开说。 */}
        <span className="lowest-line" style={{ color: 'var(--fg-meta)' }}>
          {hasPrices ? '本口径无价' : '未报价'}
        </span>
      </div>
    );
  }

  // 单组：出金额 + 单位。
  // **单位必须跟着写**：group_lowest 是折算到比价单位后的价，而列表左边的「单位」列写的是
  // 基础单位（如「套」）。桁架背景板一"套"是 18 ㎡，只写 ¥80.56 会被读成"一套 80.56"——
  // 差 18 倍，而且看起来完全正常。
  if (!summary?.isMultiGroup && groups.length === 1) {
    const g = groups[0]!;
    const unit = unitLabel(g.unitCode, unitName);
    return (
      <div className={cx('lowest-lines', className)}>
        <b
          className="num"
          style={{ color: 'var(--success)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--text-sm)' }}
          aria-label={`最低 ${formatMoney(g.groupLowest)} 元每${unit}`}
        >
          {formatMoney(g.groupLowest, { symbol: true })}
          {unit ? <span className="t-2xs t-3">/{unit}</span> : null}
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
          {g.unitCode ? `/${unitLabel(g.unitCode, unitName)}` : ''}
        </span>
      ))}
      {rest > 0 ? <span className="lowest-line t-3">还有 {rest} 种</span> : null}
    </div>
  );
}
