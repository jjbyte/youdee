'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, formatQty, formatRate } from '@/lib/format';
import { groupLabel, supplierTypeLabel, unitLabel } from '@/lib/labels';
import type { ItemDetail, PricingNature, QuoteListItem, TaxBasis } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { Select } from '@/components/ui/field';
import type { RankedRow, SummaryFacts } from '@/lib/compare-local';

/**
 * 比价页吸底操作条（§C.4 底部 64px）。
 *
 * 「已选 X · 性质 · 数量 · 成本」这四个词缺一不可：攒进报价单的动作发生在
 * 用户看着某一家的时候，而这一行是他在弹窗里唯一能核对的凭据。
 *
 * 攒单**不猜价**：直接把这行的 price_id 交给服务端解析成本，
 * 前端算的只是给人看的数字。
 */
export function CompareFootbar({
  item,
  row,
  qty,
  taxBasis,
  nature,
  facts,
  onClear,
  onAddPrice,
  onAdded,
}: {
  item: ItemDetail;
  row: RankedRow | null;
  qty: number;
  taxBasis: TaxBasis;
  nature: PricingNature;
  facts: SummaryFacts;
  onClear: () => void;
  onAddPrice: () => void;
  onAdded: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [targetMargin, setTargetMargin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cmpUnit = unitLabel(item.compareUnitCode, item.compareUnitName) || unitLabel(item.baseUnitCode, item.baseUnitName);
  const rowUnit = row ? unitLabel(row.row.unitCode) : cmpUnit;
  const shownUnit = row && row.exclusive === 'UNIT_NOT_COMPARABLE' ? rowUnit : cmpUnit;
  const unitPrice = row ? (row.exclusive === 'UNIT_NOT_COMPARABLE' ? row.hit.unitPrice : row.hit.baseUnitPrice) : null;
  const total = unitPrice !== null ? Number(unitPrice) * qty : null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .quotes({ status: 'draft', limit: 20 })
      .then((p) => {
        setQuotes(p.items ?? []);
        setQuoteId(p.items?.[0]?.id ?? '');
      })
      .catch((e) => setError(errorMessage(e)));
  }, [open]);

  useEffect(() => {
    if (!quoteId) {
      setTargetMargin(null);
      return;
    }
    api
      .quote(quoteId)
      .then((d) => setTargetMargin(d.targetMarginRate))
      .catch(() => setTargetMargin(null));
  }, [quoteId]);

  async function submit() {
    if (!row) return;
    if (!quoteId) {
      setError('先选一张草稿单。没有的话去「报价单」新建一张。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        lineKind: item.itemType,
        pricingNature: nature,
        itemNameSnapshot: item.name,
        specSnapshot: item.spec,
        categorySnapshot: item.categoryName,
        unitSnapshot: shownUnit,
        qty: String(qty),
        // 必传，无默认值：省略等于宣称"成本来自价格库"，而这个指标一旦失真就再也修不回来
        costSource: 'price_book',
        priceId: row.row.priceId,
        itemId: item.id,
        supplierId: row.row.supplierId,
        supplierNameSnapshot: row.row.supplierName,
        referenceLowestPrice: facts.lowest?.hit.baseUnitPrice ?? null,
        referenceLowestSupplierId: facts.lowest?.row.supplierId ?? null,
        sourceTierMinQty: row.hit.tierMinQty !== null ? String(row.hit.tierMinQty) : null,
        priceEffectiveFrom: row.row.effectiveFrom,
        priceEffectiveTo: row.row.effectiveTo,
      };
      // 单上没设目标毛利率时服务端无法反推对客价，这里必须先算出来再传
      if (!targetMargin && unitPrice !== null) {
        body.saleUnitPrice = (Number(unitPrice) / 0.75).toFixed(2);
      }
      await api.addQuoteItem(quoteId, body);
      setOpen(false);
      onAdded(`攒进去了。${row.row.supplierName} · ${formatMoney(unitPrice, { symbol: true })} × ${formatQty(qty)} ${shownUnit}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="flex items-center gap-[var(--space-4)] px-[var(--space-6)] py-[var(--space-3)] border-t border-[var(--border)] bg-[var(--surface)]"
        style={{ minHeight: 'var(--cmp-footbar-h)' }}
      >
        {row ? (
          <>
            <span className="t-xs t-3">已选</span>
            <span className="fw-semi truncate">{row.row.supplierName}</span>
            <span className="t-xs t-3">{supplierTypeLabel(row.row.supplierType, item.itemType)}</span>
            <span className="t-xs t-3">·</span>
            <span className="t-xs">{groupLabel(nature, null, item.itemType)}</span>
            <span className="t-xs t-3">·</span>
            <span className="t-xs num">
              {formatQty(qty)} {shownUnit}
            </span>
            <span className="t-xs t-3">·</span>
            <span className="t-xs">
              成本 <span className="num fw-semi">{total !== null ? formatMoney(total, { symbol: true }) : '—'}</span>
            </span>
            {row.exclusive === 'UNIT_NOT_COMPARABLE' ? (
              <span className="t-2xs t-warning">按「{shownUnit}」计，没折算</span>
            ) : null}
            <button type="button" className="btn btn--link ml-auto" onClick={onClear}>
              取消选择
            </button>
          </>
        ) : (
          <span className="t-sm t-3">点一张卡片选中它，再攒进报价单。</span>
        )}

        <Button variant="ghost" size="sm" onClick={onAddPrice}>
          录一条新价
        </Button>
        <Button
          variant="primary"
          disabled={!row}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          攒进报价单
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="攒进哪张单"
        width="520px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              先不攒
            </Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              攒进去
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-4)]">
          {quotes.length === 0 && !error ? (
            <Note tone="neutral">没有草稿单。先去「报价单」建一张，再回来攒这个价。</Note>
          ) : (
            <label className="flex flex-col gap-[var(--space-2)]">
              <span className="label">草稿单</span>
              <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} aria-label="选择草稿单">
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.customerName} · {q.eventName}（{q.itemCount} 项）
                  </option>
                ))}
              </Select>
            </label>
          )}

          {row ? (
            <div className="note">
              <div>
                <div className="t-sm">
                  {item.name}
                  {item.spec ? <span className="t-3"> · {item.spec}</span> : null}
                </div>
                <div className="t-xs t-2 mt-[var(--space-1)]">
                  {row.row.supplierName} · {groupLabel(nature, null, item.itemType)} · {formatQty(qty)} {shownUnit} ·{' '}
                  {taxBasis === 'inclusive' ? '含税' : '不含税'}口径
                </div>
                <div className="t-xs t-3 mt-[var(--space-1)]">
                  成本 {formatMoney(total, { symbol: true })}
                  {targetMargin ? ` · 对客按本单目标毛利率 ${formatRate(targetMargin)} 反推` : ' · 本单没设目标毛利率，先按 25% 毛利率反推'}
                </div>
                {row.exclusive === 'UNIT_NOT_COMPARABLE' ? (
                  <div className="t-xs t-warning mt-[var(--space-2)]">
                    这家按「{rowUnit}」报价，攒进单里就按 {rowUnit} 计。要按 {cmpUnit} 比先去补一下换算关系。
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? <Note tone="danger">{error}</Note> : null}
        </div>
      </Modal>
    </>
  );
}
