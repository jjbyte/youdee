'use client';
import { formatMoney, formatQty } from '@/lib/format';
import { unitLabel } from '@/lib/labels';
import type { CompareTier } from '@/lib/types';
import { IconCheck } from '@/components/icons';
import { Note } from '@/components/ui/states';

/**
 * 阶梯价小表（§D.2）。
 *
 * 两处必须做对：
 *   ① 命中档高亮 + 勾选图标 —— 报价员核对的是「我这一单落在哪一档」，不是整张表；
 *   ② 断档要说出来而不是悄悄取相邻档 —— 30–34 没有价这件事必须可见（§D.2 断档行）。
 */
export function TierPriceList({
  tiers,
  qtyPriced,
  unitCode,
  unitName,
  emptyPrice,
  emptyHint = '这家没设阶梯价。',
  onSetTiers,
}: {
  tiers: CompareTier[];
  /** 命中用的数量（已按 base_unit_qty 折算过） */
  qtyPriced: number;
  unitCode: string;
  unitName?: string | null;
  /** 无阶梯时的统一单价 */
  emptyPrice?: string | null;
  emptyHint?: string;
  onSetTiers?: () => void;
}) {
  const unit = unitLabel(unitCode, unitName);

  if (tiers.length === 0) {
    return (
      <div>
        <div className="t-sm t-2">
          {emptyHint}
          {emptyPrice ? (
            <>
              {' '}
              统一 <span className="num">{formatMoney(emptyPrice, { symbol: true })}</span>
              {unit ? ` / ${unit}` : ''}。
            </>
          ) : null}
        </div>
        {onSetTiers ? (
          <button type="button" className="btn btn--link mt-[var(--space-2)]" onClick={onSetTiers}>
            设置阶梯价
          </button>
        ) : null}
      </div>
    );
  }

  const sorted = [...tiers].sort((a, b) => Number(a.minQty) - Number(b.minQty));
  const hitIndex = (() => {
    let idx = -1;
    for (let i = 0; i < sorted.length; i += 1) {
      if (qtyPriced >= Number(sorted[i]!.minQty)) idx = i;
      else break;
    }
    return idx;
  })();

  // 断档检测：相邻两档之间 skip 了数字，这一段数量在价格库里没有价
  const gaps: string[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    const curMax = cur.maxQty === null ? null : Number(cur.maxQty);
    const nextMin = Number(next.minQty);
    if (curMax !== null && curMax + 1 < nextMin) {
      gaps.push(`${formatQty(curMax + 1)}–${formatQty(nextMin - 1)}`);
    }
  }

  const hit = hitIndex >= 0 ? sorted[hitIndex]! : null;

  return (
    <div>
      <table className="tiers">
        <caption className="sr-only">
          阶梯价，共 {sorted.length} 档，当前数量 {formatQty(qtyPriced)} {unit}
        </caption>
        <thead>
          <tr>
            <th scope="col">数量</th>
            <th scope="col" className="num">
              单价
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => {
            const isHit = i === hitIndex;
            const range = t.maxQty === null ? `≥ ${formatQty(t.minQty)}` : `${formatQty(t.minQty)} – ${formatQty(t.maxQty)}`;
            return (
              <tr key={`${t.minQty}-${t.maxQty ?? 'max'}`} data-hit={isHit || undefined}>
                <td>
                  <span className="inline-flex items-center gap-[var(--space-2)]">
                    {isHit ? <IconCheck size={16} className="t-success" /> : null}
                    {range} {unit}
                  </span>
                </td>
                <td className="num">
                  {formatMoney(t.unitPrice, { symbol: true })}
                  {t.baseUnitPrice && t.baseUnitPrice !== t.unitPrice ? (
                    <span className="t-2xs t-3 ml-[var(--space-2)]">折 {formatMoney(t.baseUnitPrice)}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="t-xs t-2 mt-[var(--space-3)]">
        {hit ? (
          <>
            数量 <span className="num">{formatQty(qtyPriced)}</span> → 命中{' '}
            {hit.maxQty === null ? `≥ ${formatQty(hit.minQty)}` : `${formatQty(hit.minQty)} – ${formatQty(hit.maxQty)}`} 档，
            单价 <span className="num">{formatMoney(hit.unitPrice, { symbol: true })}</span>
            {unit ? ` / ${unit}` : ''}
          </>
        ) : (
          <>
            数量 <span className="num">{formatQty(qtyPriced)}</span> 低于第一档起订{' '}
            <span className="num">{formatQty(sorted[0]!.minQty)}</span> {unit}，照第一档价计。
          </>
        )}
      </div>

      {gaps.length > 0 ? (
        <Note tone="warn" className="mt-[var(--space-3)]">
          {gaps.join('、')} {unit} 这一段没设价格，这段数量取相邻档的价。
        </Note>
      ) : null}
    </div>
  );
}
