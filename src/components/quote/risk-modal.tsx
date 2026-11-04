'use client';
import { useState } from 'react';
import { formatDate, formatMoney, formatRate } from '@/lib/format';
import type { QuoteDetail, RiskCheckResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { IconRisk } from '@/components/icons';

export interface RiskItem {
  level: 'blocker' | 'warning';
  text: string;
  detail?: string;
  lines: number[];
}

/**
 * 发送前自检（§C.7 / TC-8：7 条 warning + 1 条 blocker）。
 *
 * 这不是审批流，拦的是「蠢单」不是「没权限的单」。
 * **7 条 warning 一律不阻断**；唯一 blocker 是客户名为空——
 * 报价单是对外文件，抬头空着就发不出去。存草稿不阻断。
 *
 * 主按钮是「回去改」（朱砂填充），次按钮是「都看过了，生成」（描边）：
 * 这张弹窗出现的时刻本来就说明已经出了点问题，默认应该把人推回去改。
 */
export function buildRiskItems(quote: QuoteDetail, risk: RiskCheckResult | null): RiskItem[] {
  const items: RiskItem[] = [];
  const lineNo = (id: string | null) => (id ? quote.items.findIndex((l) => l.id === id) + 1 : 0);

  // ① 整单毛利率低于阈值
  const margin = quote.marginRate === null ? null : Number(quote.marginRate);
  const warnRate = quote.warnRateUsed ? Number(quote.warnRateUsed) : null;
  if (margin !== null && warnRate !== null && margin < warnRate && margin >= 0) {
    items.push({
      level: 'warning',
      text: `整单毛利率 ${formatRate(quote.marginRate)}，低于你设的 ${(warnRate * 100).toFixed(0)}%`,
      detail: `对客 ${formatMoney(quote.totalPrice, { symbol: true })} / 成本 ${formatMoney(quote.totalCost, { symbol: true })}`,
      lines: [],
    });
  }

  // ② 手填成本的行
  for (const l of quote.items) {
    if (l.costSource === 'manual') {
      items.push({
        level: 'warning',
        text: `第 ${lineNo(l.id)} 行「${l.itemNameSnapshot}」成本是手填的，价格库里没有这个价`,
        detail: '内部版上会标出来。',
        lines: [lineNo(l.id)],
      });
    }
  }

  // ③ 成本高于「录这单时」的同性质同口径最低价（用行上的快照算，不是拿现在的价算）
  for (const l of quote.items) {
    if (!l.referenceLowestPrice || l.costUnitPrice === null) continue;
    const cost = Number(l.costUnitPrice);
    const lowest = Number(l.referenceLowestPrice);
    if (!Number.isFinite(cost) || !Number.isFinite(lowest) || lowest <= 0 || cost <= lowest) continue;
    const diff = (cost - lowest) * Number(l.qty);
    items.push({
      level: 'warning',
      text: `第 ${lineNo(l.id)} 行成本 ${formatMoney(cost, { symbol: true })}，录单时别家最低 ${formatMoney(lowest, { symbol: true })}，这行多花 ${formatMoney(diff, { symbol: true })}`,
      detail: '同性质 + 同计价方式 + 同税口径才可比，别的性质不参与这条。',
      lines: [lineNo(l.id)],
    });
  }

  // ④ 这行用的价已被新价取代（服务端 stale_draft_items 的口径，与“很久没核价”不是一回事）
  for (const s of risk?.staleDraftItems ?? []) {
    const no = s.lineIndexes?.[0] ?? lineNo(s.itemId);
    items.push({
      level: 'warning',
      text: `第 ${no} 行「${s.itemNameSnapshot}」用的价已经被新价取代了（单子上是 ${formatMoney(s.snapshotPrice, { symbol: true })}，现在 ${formatMoney(s.latestPrice, { symbol: true })}）`,
      lines: s.lineIndexes ?? [no],
    });
  }

  // ⑤ 单行亏钱
  for (const n of risk?.negativeMarginItems ?? []) {
    const no = n.lineIndexes?.[0] ?? lineNo(n.itemId);
    items.push({
      level: 'warning',
      text: `第 ${no} 行「${n.itemNameSnapshot}」亏 ${formatMoney(Number(n.lineProfit) * -1, { symbol: true })}，对客价低于成本`,
      lines: n.lineIndexes ?? [no],
    });
  }

  // ⑥ 对客价为 0
  for (const z of risk?.zeroPriceItems ?? []) {
    const no = z.lineIndexes?.[0] ?? lineNo(z.itemId);
    items.push({
      level: 'warning',
      text: `第 ${no} 行「${z.itemNameSnapshot}」对客价是 0，客户会看到一行不要钱的东西`,
      lines: z.lineIndexes ?? [no],
    });
  }

  // ⑦ 价的失效日早于活动日
  for (const p of risk?.priceExpiring ?? []) {
    const no = p.lineIndexes?.[0] ?? lineNo(p.itemId);
    if (quote.eventDate && p.effectiveTo >= quote.eventDate) continue;
    items.push({
      level: 'warning',
      text: quote.eventDate
        ? `第 ${no} 行「${p.itemNameSnapshot}」的价 ${formatDate(p.effectiveTo)} 就到期了，活动是 ${formatDate(quote.eventDate)}`
        : `第 ${no} 行「${p.itemNameSnapshot}」的价 ${formatDate(p.effectiveTo)} 到期了`,
      lines: p.lineIndexes ?? [no],
    });
  }

  if (risk?.validUntilPassed) {
    items.push({
      level: 'warning',
      text: `这张单的有效期 ${formatDate(quote.validUntil)} 已经过了`,
      lines: [],
    });
  }

  // blocker：客户名为空。只在出单这一个动作上阻断，存草稿不阻断。
  if (!quote.customerName.trim()) {
    items.unshift({ level: 'blocker', text: '客户名还没填', detail: '报价单是要发给客户的，抬头空着发不出去。', lines: [] });
  }

  return items;
}

export function RiskModal({
  open,
  quote,
  risk,
  issuing,
  onClose,
  onGoFillCustomer,
  onConfirm,
}: {
  open: boolean;
  quote: QuoteDetail;
  risk: RiskCheckResult | null;
  issuing: boolean;
  onClose: () => void;
  onGoFillCustomer: () => void;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const items = buildRiskItems(quote, risk);
  const blocker = items.find((i) => i.level === 'blocker');
  const warnings = items.filter((i) => i.level === 'warning');

  if (blocker) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="发不出去"
        icon={<IconRisk size={20} className="t-danger" />}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              存草稿
            </Button>
            <Button variant="primary" onClick={onGoFillCustomer}>
              去填客户
            </Button>
          </>
        }
      >
        <div className="t-sm">
          <div className="fw-semi">{blocker.text}</div>
          {blocker.detail ? <p className="t-2 mt-[var(--space-2)]">{blocker.detail}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`发出前，看一眼这 ${warnings.length} 件事`}
      width="600px"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            回去改
          </Button>
          <Button
            variant={armed ? 'primary' : 'secondary'}
            loading={issuing}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              onConfirm();
            }}
          >
            {armed ? `确认发出（已看过 ${warnings.length} 条）` : '都看过了，生成'}
          </Button>
        </>
      }
    >
      {warnings.length === 0 ? (
        <p className="t-sm t-2">没有需要提醒的。直接发出就行。</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-4)]">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-[var(--space-3)]">
              <IconRisk size={16} className="t-warning mt-[3px] shrink-0" />
              <div className="min-w-0">
                <div className="t-sm">{w.text}</div>
                {w.detail ? <div className="t-2xs t-3 mt-[var(--space-1)]">{w.detail}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
