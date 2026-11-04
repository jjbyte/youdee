'use client';
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { effectiveStateLabel, groupLabel, supplierTypeLabel, unitLabel } from '@/lib/labels';
import type { CompareResult, ItemDetail, PricingNature, TaxBasis } from '@/lib/types';
import { rankRows, summarize, tierOptions, type RankedRow } from '@/lib/compare-local';
import { Segmented } from '@/components/ui/segmented';
import { TableWrap } from '@/components/ui/table';
import { IconChevronDown } from '@/components/icons';
import { NatureTab, type NatureSegment } from './nature-tab';
import { QtyTierSwitch } from './qty-tier-switch';
import { CompareSummary } from './compare-summary';
import { SupplierPriceCard } from './supplier-price-card';
import { PriceCompareTable } from './price-compare-table';
import { CompareFootbar } from './compare-footbar';

const NATURE_ORDER: PricingNature[] = ['rental_per_day', 'purchase', 'custom_made', 'service'];
const MODE_ORDER: string[] = ['per_day', 'per_event', 'per_person_day', 'per_hour', 'per_half_day', ''];

function segKey(nature: PricingNature, mode: string | null): string {
  return `${nature}::${mode ?? ''}`;
}

/**
 * 比价工作台：数量档 → 交易性质 Tab → 摘要条 → 卡片/表格 → 失效折叠区 → 吸底操作条。
 *
 * 顺序不能动：
 *   数量档在最上（用户先定「要多少」）；
 *   Tab 在摘要条**之上**，因为摘要条讲的是「当前这个性质里谁最便宜」（§D.1C 硬要求）；
 *   不可比的行不隐藏，只是排到可比行之后并灰化；
 *   失效/被替代的价**移出分组**收进折叠区——让「这一组里都是能用的价」成为可依赖的前提。
 */
export function CompareWorkbench({
  item,
  compare,
  taxBasis,
  onTaxBasis,
  onOpenPriceDrawer,
  onToast,
}: {
  item: ItemDetail;
  compare: CompareResult;
  taxBasis: TaxBasis;
  onTaxBasis: (b: TaxBasis) => void;
  onOpenPriceDrawer: () => void;
  onToast: (message: string) => void;
}) {
  const [qty, setQty] = useState(() => {
    const bp = compare.tierBreakpoints ?? [];
    return bp.length ? Math.min(...bp) : 1;
  });
  const [view, setView] = useState<'card' | 'table'>('card');
  const [segOverride, setSegOverride] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cmpUnitCode = item.compareUnitCode ?? item.baseUnitCode;
  const cmpUnitName = item.compareUnitName ?? item.baseUnitName;
  const cmpUnit = unitLabel(cmpUnitCode, cmpUnitName);

  const segments = useMemo(() => {
    const built = (compare.groups ?? []).map((g) => {
      const ranked = rankRows(g.rows ?? [], taxBasis, qty);
      const live = ranked.filter((r) => !r.expired);
      const facts = summarize(ranked);
      return { key: segKey(g.pricingNature, g.pricingMode), group: g, ranked, live, facts };
    });
    // 固定顺序：租赁 → 买断 → 定制（活动公司 90% 是租，放第一减少滚动）
    return built.sort((a, b) => {
      const na = NATURE_ORDER.indexOf(a.group.pricingNature);
      const nb = NATURE_ORDER.indexOf(b.group.pricingNature);
      if (na !== nb) return na - nb;
      return MODE_ORDER.indexOf(a.group.pricingMode ?? '') - MODE_ORDER.indexOf(b.group.pricingMode ?? '');
    });
  }, [compare.groups, taxBasis, qty]);

  // 默认选中「行数最多的那一组」——用户这次要看的是哪一类报价最多，不是建物料时被标成哪类
  const defaultSeg = useMemo(() => {
    let best = segments[0]?.key ?? '';
    let bestCount = -1;
    for (const s of segments) {
      if (s.live.length > bestCount) {
        best = s.key;
        bestCount = s.live.length;
      }
    }
    return best;
  }, [segments]);

  const activeKey = segOverride && segments.some((s) => s.key === segOverride) ? segOverride : defaultSeg;
  const active = segments.find((s) => s.key === activeKey) ?? segments[0] ?? null;

  const selected: RankedRow | null =
    active?.ranked.find((r) => r.row.priceId === selectedId) ?? null;

  const tabSegments: NatureSegment[] = segments.map((s) => ({
    key: s.key,
    label: groupLabel(s.group.pricingNature, s.group.pricingMode, item.itemType),
    comparableCount: s.facts.comparableCount,
    totalCount: s.live.length,
    lowest: s.facts.lowest?.hit.baseUnitPrice ?? null,
    lowestUnit: `/${cmpUnit}`,
    blocked: !s.group.comparable,
  }));

  const qtyOptions = tierOptions(compare.tierBreakpoints, qty);
  const expired = active?.ranked.filter((r) => r.expired) ?? [];

  if (!active) {
    return (
      <div className="state">
        <div className="state__title">这个物料还没有任何报价。</div>
        <div className="state__body">先录一条：选个供应商，填个单价，写个生效日期就够了。</div>
        <div className="state__actions">
          <button type="button" className="btn btn--primary" onClick={onOpenPriceDrawer}>
            录第一条价
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <QtyTierSwitch
        qty={qty}
        options={qtyOptions}
        unitCode={cmpUnitCode}
        unitName={cmpUnitName}
        onChange={(n) => setQty(n)}
      >
        <span className="cmp-qtybar__label">口径</span>
        <Segmented<'inclusive' | 'exclusive'>
          ariaLabel="含税口径"
          value={taxBasis}
          options={[
            { value: 'inclusive', label: '含税' },
            { value: 'exclusive', label: '不含税' },
          ]}
          onChange={onTaxBasis}
        />
        <Segmented<'card' | 'table'>
          ariaLabel="视图"
          value={view}
          options={[
            { value: 'card', label: '卡片' },
            { value: 'table', label: '表格' },
          ]}
          onChange={setView}
        />
      </QtyTierSwitch>

      {segments.length > 1 ? (
        <NatureTab
          segments={tabSegments}
          value={activeKey}
          ariaLabel={item.itemType === 'personnel' ? '计价方式' : '交易性质'}
          onChange={(k) => {
            setSegOverride(k);
            setSelectedId(null);
          }}
        />
      ) : null}

      {view === 'card' ? (
        <CompareSummary
          facts={active.facts}
          qty={qty}
          unitCode={cmpUnitCode}
          unitName={cmpUnitName}
          nature={active.group.pricingNature}
          onFixConversion={onOpenPriceDrawer}
          onFixTax={onOpenPriceDrawer}
        />
      ) : null}

      <div
        role="tabpanel"
        id={`nature-panel-${activeKey}`}
        aria-labelledby={`nature-tab-${activeKey}`}
        className="flex-1 overflow-auto"
      >
        {view === 'card' ? (
          <>
            {active.live.length === 0 ? (
              <div className="state">
                <div className="state__title">这一组没有能用的价。</div>
                <div className="state__body">
                  {expired.length > 0
                    ? `${expired.length} 条价已经过期，收在下面的「已失效」里。录一条今天生效的价就能比了。`
                    : '这一组还没有录过价。'}
                </div>
                <div className="state__actions">
                  <button type="button" className="btn btn--primary" onClick={onOpenPriceDrawer}>
                    录一条价
                  </button>
                </div>
              </div>
            ) : (
              <div className="cmp-grid">
                {active.live.map((r) => (
                  <SupplierPriceCard
                    key={r.row.priceId}
                    r={r}
                    itemId={item.id}
                    pricingNature={active.group.pricingNature}
                    itemType={item.itemType}
                    compareUnitCode={cmpUnitCode}
                    compareUnitName={cmpUnitName}
                    pageTaxBasis={taxBasis}
                    qty={qty}
                    allowLowestBadge={active.facts.comparableCount >= 2}
                    selected={selectedId === r.row.priceId}
                    onSelect={() => setSelectedId(r.row.priceId)}
                    onAddPrice={onOpenPriceDrawer}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <PriceCompareTable
            groups={segments.map((s) => ({
              key: s.key,
              label: groupLabel(s.group.pricingNature, s.group.pricingMode, item.itemType),
              ranked: s.ranked,
            }))}
            itemType={item.itemType}
            compareUnitCode={cmpUnitCode}
            compareUnitName={cmpUnitName}
            pageTaxBasis={taxBasis}
            missingSuppliers={compare.missingSuppliers ?? []}
            selectedId={selectedId}
            onSelect={(r) => {
              // 表格视图能看全所有分组，点某一行要把 Tab 同步到那一组，否则吸底条会报错性质
              const owner = segments.find((s) => s.ranked.some((x) => x.row.priceId === r.row.priceId));
              setSelectedId(r.row.priceId);
              if (owner) setSegOverride(owner.key);
            }}
          />
        )}

        {expired.length > 0 ? (
          <ExpiredSection rows={expired} unitCode={cmpUnitCode} unitName={cmpUnitName} itemType={item.itemType} />
        ) : null}

        {compare.missingSuppliers && compare.missingSuppliers.length > 0 && view === 'card' ? (
          <div className="note mt-[var(--space-4)]">
            <div>
              <div className="t-xs">
                {compare.missingSuppliers.map((m) => m.supplierName).join('、')} 有历史报价，但今天没有有效价。
              </div>
              <div className="t-2xs t-3 mt-[var(--space-1)]">
                这不算「没报价」——是这一天的价用不了。要用它，得先录一条今天生效的。
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-[var(--z-sticky)]">
        <CompareFootbar
          item={item}
          row={selected}
          qty={qty}
          taxBasis={taxBasis}
          nature={active.group.pricingNature}
          facts={active.facts}
          onClear={() => setSelectedId(null)}
          onAddPrice={onOpenPriceDrawer}
          onAdded={onToast}
        />
      </div>
    </div>
  );
}

/** 已失效 / 历史价（3 条，不参与比价）——移出分组，收进折叠区 */
function ExpiredSection({
  rows,
  unitCode,
  unitName,
  itemType,
}: {
  rows: RankedRow[];
  unitCode: string;
  unitName?: string | null;
  itemType: ItemDetail['itemType'];
}) {
  const [open, setOpen] = useState(false);
  const unit = unitLabel(unitCode, unitName);

  return (
    <section className="mt-[var(--space-5)]">
      <button
        type="button"
        className="flex items-center gap-[var(--space-2)] t-sm t-2 w-full text-left py-[var(--space-2)]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown
          size={16}
          style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 150ms' }}
        />
        已失效 / 历史价（{rows.length} 条，不参与比价）
      </button>

      {open ? (
        <TableWrap maxHeight="320px">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">供应商</th>
                <th scope="col">类型</th>
                <th scope="col" className="ta-r">
                  单价 / {unit}
                </th>
                <th scope="col">失效日</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row.priceId}>
                  <td>{r.row.supplierName}</td>
                  <td>{supplierTypeLabel(r.row.supplierType, itemType)}</td>
                  <td className="ta-r num">{formatMoney(r.row.baseUnitPrice, { symbol: true })}</td>
                  <td>{r.row.effectiveTo ?? '—'}</td>
                  <td className="t-3 t-xs">{effectiveStateLabel(r.row.effectiveState)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </section>
  );
}
