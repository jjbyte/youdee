'use client';
import { useState } from 'react';
import { cx, formatMoney, formatQty, formatStaleDays } from '@/lib/format';
import { unitLabel } from '@/lib/labels';
import { supplierTypeLabel } from '@/lib/labels';
import type { ItemType, TaxBasis } from '@/lib/types';
import type { RankedRow } from '@/lib/compare-local';
import { tierCaseText } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import {
  IconChevronDown,
  IconSupplierFactory,
  IconSupplierFreelancer,
  IconSupplierInternal,
  IconSupplierOnline,
  IconSupplierRental,
  IconTiers,
  IconRisk,
} from '@/components/icons';
import { TierPriceList } from './tier-price-list';
import { PriceTrendMini } from './price-trend-mini';

const TYPE_ICON = {
  online: IconSupplierOnline,
  factory: IconSupplierFactory,
  rental: IconSupplierRental,
  freelancer: IconSupplierFreelancer,
  internal: IconSupplierInternal,
} as const;

/**
 * 比价卡片（§D.1.1）。
 *
 * 五重编码标最低（位置 / 摘要条 / 徽章 / 字号 26 对 22 / 2px 描边+底色），
 * 但**颜色不是唯一信息载体**——徽章里有「最低」两个字。
 *
 * 四种状态一一对应数据条件，前端不自创第五种：
 *   正常可比 / 组内最低 / 未折算·口径不一致（琥珀、不排序、不标最低）/ 不可选（qty < 起订）。
 */
export function SupplierPriceCard({
  r,
  itemId,
  pricingNature,
  itemType,
  compareUnitCode,
  compareUnitName,
  pageTaxBasis,
  qty,
  allowLowestBadge,
  selected,
  onSelect,
  onAddPrice,
}: {
  r: RankedRow;
  itemId: string;
  pricingNature: string;
  itemType: ItemType;
  compareUnitCode: string;
  compareUnitName?: string | null;
  pageTaxBasis: TaxBasis;
  qty: number;
  /** 同口径可比 ≥ 2 家才允许标「最低」——1 家标最低等于没说 */
  allowLowestBadge: boolean;
  selected: boolean;
  onSelect: () => void;
  onAddPrice?: () => void;
}) {
  const [trendOpen, setTrendOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);

  const { row, hit, exclusive } = r;
  const cmpUnit = unitLabel(compareUnitCode, compareUnitName);
  const ownUnit = unitLabel(row.unitCode);
  const converted = row.compareState === 'converted';
  const blockedByMoq = hit.tierCase === 'below_moq';
  const notComparable = exclusive === 'UNIT_NOT_COMPARABLE';

  // 显示哪一档价：不可比的行**不能**展示 baseUnitPrice（接口原话：该值无业务含义）
  const shownPrice = notComparable ? hit.unitPrice : hit.baseUnitPrice;
  const shownUnit = notComparable ? ownUnit : cmpUnit;

  const isLowestCard = allowLowestBadge && r.isLowest && exclusive === null;

  const unitLine = [
    `/${shownUnit}`,
    row.taxIncluded ? '含税' : '不含税',
    row.moq ? `起订 ${formatQty(row.moq)}${ownUnit}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const aux = [
    row.defaultLeadTimeDays ? `交期 ${row.defaultLeadTimeDays} 天` : null,
    row.effectiveTo ? `有效到 ${row.effectiveTo}` : '长期有效',
  ]
    .filter(Boolean)
    .join(' · ');

  const TypeIcon = TYPE_ICON[row.supplierType];

  const ariaExtra = [
    `${row.supplierName}`,
    `${shownPrice ? formatMoney(shownPrice, { symbol: false }) : '没有价'} 元每${shownUnit}`,
    row.taxIncluded ? '含税' : '不含税',
    isLowestCard ? '当前最低' : null,
    exclusive === 'UNIT_NOT_COMPARABLE' ? '单位没折算，不参与比价' : null,
    exclusive === 'TAX_BASIS_MISMATCH'
      ? `只有${row.taxIncluded ? '含税' : '不含税'}价，本页按${pageTaxBasis === 'inclusive' ? '含税' : '不含税'}比`
      : null,
    blockedByMoq ? '低于起订量，不能按这个数量用' : null,
  ]
    .filter(Boolean)
    .join('，');

  return (
    <>
      <div
        role="group"
        aria-label={ariaExtra}
        aria-current={selected || undefined}
        tabIndex={0}
        data-lowest={isLowestCard || undefined}
        data-blocked={blockedByMoq || undefined}
        data-muted={(exclusive !== null && !blockedByMoq) || undefined}
        className={cx('cmp-card', selected && 'outline outline-2 outline-[var(--accent)] outline-offset-1')}
        onClick={() => !blockedByMoq && onSelect()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!blockedByMoq) onSelect();
          } else if (e.key === ' ') {
            e.preventDefault();
            if (!blockedByMoq) onSelect();
          }
        }}
        style={blockedByMoq ? { cursor: 'not-allowed' } : { cursor: 'pointer' }}
      >
        <div className="cmp-card__badges">
          {isLowestCard ? (
            <Badge tone={r.isLowestTied ? 'lowest-tie' : 'lowest'}>{r.isLowestTied ? '最低 · 并列' : '最低'}</Badge>
          ) : null}
          {exclusive === 'UNIT_NOT_COMPARABLE' ? (
            <Badge tone="warn" icon={<IconRisk size={16} />}>
              未折算
            </Badge>
          ) : null}
          {exclusive === 'TAX_BASIS_MISMATCH' ? (
            <Badge tone="warn" icon={<IconRisk size={16} />}>
              只有{row.taxIncluded ? '含税' : '不含税'}价
            </Badge>
          ) : null}
          {blockedByMoq ? (
            <Badge tone="warn" icon={<IconRisk size={16} />}>
              起订 {formatQty(row.moq)} {ownUnit}，按 {formatQty(qty)} {cmpUnit} 不满足
            </Badge>
          ) : null}
          <span className="spacer" />
          {row.supplierType === 'internal' ? <Badge tone="internal">自有</Badge> : null}
          <Badge tone="neutral" icon={<TypeIcon size={16} />}>
            {supplierTypeLabel(row.supplierType, itemType)}
          </Badge>
        </div>

        <div className="cmp-card__name">
          <span className="truncate" title={row.supplierName}>
            {row.supplierName}
          </span>
          <span className={cx('cmp-card__time', row.stalenessDays > 90 && 't-warning')}>
            {row.stalenessDays === 0 ? '今天' : row.stalenessDays === 1 ? '昨天' : formatStaleDays(row.stalenessDays)}
            {row.stalenessDays > 90 ? ' 未核价' : ''}
          </span>
        </div>

        <div className="cmp-card__rule" />

        <div className="text-right">
          <span className="cmp-card__price num">
            {blockedByMoq ? <del>{formatMoney(shownPrice, { symbol: true })}</del> : formatMoney(shownPrice, { symbol: true })}
          </span>
        </div>

        <div className="cmp-card__unit">{unitLine}</div>

        {/* 折算价必须让原价看得见，否则用户不知道 60 是怎么来的，会不信这个数 */}
        {converted && row.baseUnitQty ? (
          <div className="cmp-card__line">
            原报 {formatMoney(hit.unitPrice, { symbol: true })}/{ownUnit}（1 {cmpUnit} = {formatQty(row.baseUnitQty)}{' '}
            {ownUnit}）
          </div>
        ) : null}

        <div className="cmp-card__rule" />

        <div className="flex items-center justify-between gap-[var(--space-2)]">
          <span
            className={cx(
              't-xs',
              hit.tierCase === 'in_tier' && 't-success',
              (hit.tierCase === 'above_max' || hit.tierCase === 'gap') && 't-warning',
              hit.tierCase === 'below_moq' && 't-warning',
              hit.tierCase === 'no_tiers' && 't-3',
            )}
          >
            {tierCaseText(hit.tierCase, hit.range)}
          </span>
          {row.tiers.length > 0 ? (
            <button
              type="button"
              className="btn btn--link t-2xs"
              onClick={(e) => {
                e.stopPropagation();
                setTiersOpen(true);
              }}
            >
              <IconTiers size={16} />
              {row.tiers.length} 档
            </button>
          ) : null}
        </div>

        <div className="cmp-card__line">{aux}</div>

        {exclusive === 'UNIT_NOT_COMPARABLE' ? (
          <div className="cmp-card__line t-warning">单位不一致，不参与排序，也不标最低</div>
        ) : null}
        {exclusive === 'TAX_BASIS_MISMATCH' ? (
          <div className="cmp-card__line t-warning">
            本页按{pageTaxBasis === 'inclusive' ? '含税' : '不含税'}比，这行不在这个口径里
          </div>
        ) : null}

        <div className="cmp-card__foot">
          <button
            type="button"
            className="cmp-card__trend"
            aria-expanded={trendOpen}
            onClick={(e) => {
              e.stopPropagation();
              setTrendOpen((v) => !v);
            }}
          >
            近 12 月 展开
            <IconChevronDown
              size={16}
              style={{ transform: trendOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
            />
          </button>
        </div>

        {trendOpen ? (
          <div className="cmp-trend" onClick={(e) => e.stopPropagation()}>
            <PriceTrendMini
              itemId={itemId}
              pricingNature={pricingNature}
              supplierId={row.supplierId}
              unitCode={row.unitCode}
              height={104}
            />
          </div>
        ) : null}
      </div>

      <Modal
        open={tiersOpen}
        onClose={() => setTiersOpen(false)}
        title={`阶梯价 · ${row.supplierName}`}
        width="440px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTiersOpen(false)}>
              关掉
            </Button>
            {onAddPrice ? (
              <Button variant="secondary" onClick={onAddPrice}>
                再加一条价
              </Button>
            ) : null}
          </>
        }
      >
        <TierPriceList
          tiers={row.tiers}
          qtyPriced={Number(row.qtyPriced)}
          unitCode={row.unitCode}
          emptyPrice={row.tierUnitPrice}
        />
      </Modal>
    </>
  );
}
