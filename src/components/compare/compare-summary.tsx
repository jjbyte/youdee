'use client';
import { formatMoney, formatPct, formatQty } from '@/lib/format';
import { supplierTypeLabel, unitLabel } from '@/lib/labels';
import type { PricingNature } from '@/lib/types';
import type { SummaryFacts } from '@/lib/compare-local';

/**
 * 顶部摘要条（§C.4「44px，本页第一落点，必须被读完」）。
 *
 * 两条死规则（PM 逐条点名）：
 *   ① **金额和百分比二选一**，不并列写「便宜 ¥12（30%）」——括号里的 30% 指什么没人说得清；
 *   ② **必须带「同口径可比 N 家」**。N=1 时「最低价」是没有意义的，
 *      但摘要条会给它一种虚假的权威感，这是比价类界面最容易骗人的地方。
 *
 * 两行的分工一个字都不能换位：第 1 行 = 谁最便宜、结论建立在几家上；
 * 第 2 行 = 线上还是线下便宜（这才是报价员心里真正的问题）。
 */
export function CompareSummary({
  facts,
  qty,
  unitCode,
  unitName,
  nature,
  onFixConversion,
  onFixTax,
}: {
  facts: SummaryFacts;
  qty: number;
  unitCode: string;
  unitName?: string | null;
  nature?: PricingNature | null;
  onFixConversion?: () => void;
  onFixTax?: () => void;
}) {
  const unit = unitLabel(unitCode, unitName);
  const n = facts.comparableCount;
  const { lowest, second, onlineLowest, offlineLowest } = facts;

  /** 金额和百分比二选一；差价 < ¥10 时用金额（"便宜 3%" 听着像没便宜） */
  function gapText(rate: number, amount: number): string {
    if (Math.abs(amount) < 10) return `${formatMoney(Math.abs(amount), { symbol: true })}`;
    return formatPct(Math.abs(rate) * 100);
  }

  const line1 =
    n >= 2 && lowest
      ? `最便宜 ${formatMoney(lowest.hit.baseUnitPrice, { symbol: true })} ${lowest.row.supplierName}（${supplierTypeLabel(lowest.row.supplierType)}）`
      : n === 1 && lowest
        ? `只有 1 家能比：${formatMoney(lowest.hit.baseUnitPrice, { symbol: true })} ${lowest.row.supplierName}（${supplierTypeLabel(lowest.row.supplierType)}）`
        : `这一组没有能比的价：${facts.totalCount} 家单位或税口径不一致`;

  let line2: string;
  if (n === 0) {
    line2 = '口径不一样，不给你标最低，但都列在下面了。';
  } else if (n === 1) {
    line2 = '再录一家才看得出贵不贵';
  } else if (onlineLowest && offlineLowest) {
    const o = Number(onlineLowest.hit.baseUnitPrice);
    const f = Number(offlineLowest.hit.baseUnitPrice);
    const rate = o === 0 ? 0 : (o - f) / o;
    const tail =
      Math.abs(rate) < 1e-9
        ? '线上线下一个价'
        : rate > 0
          ? `线下便宜 ${gapText(rate, o - f)}`
          : `线上便宜 ${gapText(rate, f - o)}`;
    line2 = `线上最低 ${formatMoney(o, { symbol: true })}（${onlineLowest.row.supplierName}）　线下最低 ${formatMoney(f, { symbol: true })}（${offlineLowest.row.supplierName}），${tail}`;
  } else if (onlineLowest) {
    line2 = `只有线上 ${onlineLowest.row.supplierName} 一家能比，线下没有同口径的价，没法比线上便宜还是线下便宜`;
  } else if (offlineLowest) {
    line2 = `只有线下能比（最低 ${offlineLowest.row.supplierName}），线上没有同口径的价`;
  } else {
    line2 = '线上线下的价都不够比，先补几条报价';
  }

  // 按天租赁的防呆：¥500 和 ¥150,000 摆在一起，没人会把按天价当成一次性价
  const daysLine =
    nature === 'rental_per_day' && lowest
      ? `　按 ${formatQty(qty)} ${unit} 折 ${formatMoney(Number(lowest.hit.baseUnitPrice) * qty, { symbol: true })}（按 1 天计）`
      : '';

  return (
    <div className="cmp-summary" aria-live="polite">
      <div className="cmp-summary__line1">
        {line1}
        {n >= 2 && second ? (
          <>
            <span className="cmp-summary__sep">｜</span>
            次低 {formatMoney(second.hit.baseUnitPrice, { symbol: true })} {second.row.supplierName}
          </>
        ) : null}
        {n >= 2 ? (
          <>
            <span className="cmp-summary__sep">｜</span>
            同口径可比 {n} 家
          </>
        ) : null}
      </div>
      <div className="cmp-summary__line2">
        {line2}
        {daysLine}
        {n === 0 ? (
          <>
            {' '}
            {onFixConversion ? (
              <button type="button" className="btn btn--link" onClick={onFixConversion}>
                填换算关系
              </button>
            ) : null}
            {onFixTax ? (
              <button type="button" className="btn btn--link ml-[var(--space-3)]" onClick={onFixTax}>
                补税口径
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
