'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage, isApiError } from '@/lib/api';
import type { ItemListItem, QuoteListItem } from '@/lib/types';
import { formatMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { groupLabel } from '@/lib/labels';

/**
 * 攒进报价单（勾选多个主体一次加入）。
 *
 * 取价一律走 /price-lookup，绝不猜价；本单口径用这张草稿单自己的 tax_statement。
 * 交易性质有多种的主体不猜（同一个主体两种性质的价格不能混），逐条提示去比价页选。
 */
export function AddToQuoteModal({
  open,
  onClose,
  items,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  items: ItemListItem[];
  onDone: (message: string) => void;
}) {
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSkipped([]);
    api
      .quotes({ status: 'draft', limit: 20 })
      .then((p) => {
        setQuotes(p.items ?? []);
        setQuoteId(p.items?.[0]?.id ?? '');
      })
      .catch((e) => setError(errorMessage(e)));
  }, [open]);

  async function submit() {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) {
      setError('先选一张草稿单。');
      return;
    }
    setBusy(true);
    setError(null);
    const lines: Array<Record<string, unknown>> = [];
    const problems: string[] = [];
    try {
      // 本单口径只能从这张单自己身上读（quotes.tax_statement），不从设置页、不从第一行价推
      const detail = await api.quote(quote.id);
      const taxBasis = detail.taxStatement;
      for (const it of items) {
        const groups = it.lowestSummary?.groups ?? [];
        if (groups.length !== 1) {
          problems.push(`${it.name}：有 ${groups.length} 种交易性质，去比价页选一种再攒`);
          continue;
        }
        const nature = groups[0]!.pricingNature;
        try {
          const look = await api.priceLookup({
            itemId: it.id,
            qty,
            pricingNature: nature,
            taxBasis,
            onDate: quote.eventDate ?? todayISO(),
          });
          lines.push({
            lineKind: it.itemType,
            pricingNature: nature,
            itemId: it.id,
            itemNameSnapshot: it.name,
            specSnapshot: it.spec ?? null,
            unitSnapshot: it.baseUnitName,
            qty,
            costUnitPrice: look.baseUnitPrice,
            costSource: 'price_book',
            supplierId: look.resolvedFrom.supplierId,
            supplierNameSnapshot: look.resolvedFrom.supplierName,
            priceId: look.resolvedFrom.priceId,
            referenceLowestPrice: groups[0]!.groupLowest,
            referenceLowestSupplierId: groups[0]!.supplierId,
            saleUnitPrice: undefined,
            isVisibleToCustomer: true,
          });
        } catch (e) {
          if (isApiError(e) && e.code === 42205) {
            problems.push(`${it.name}：本单口径下没有有效价，进单后手填成本`);
          } else {
            problems.push(`${it.name}：${errorMessage(e)}`);
          }
        }
      }

      if (lines.length > 0) {
        await api.addQuoteItemsBulk(quote.id, lines);
      }
      setSkipped(problems);
      if (lines.length > 0 && problems.length === 0) {
        onDone(`攒好了 ${lines.length} 行，进单里填数量就行。`);
        onClose();
      } else if (lines.length > 0) {
        onDone(`攒了 ${lines.length} 行，${problems.length} 行没进去。`);
      } else {
        setError('这几行都没进去，看下面的原因。');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`把 ${items.length} 项攒进报价单`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            算了
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!quoteId}>
            攒进报价单
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <Field label="攒进哪一张草稿单" htmlFor="aq-quote" required>
          <Select id="aq-quote" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
            {quotes.length === 0 ? <option value="">没有草稿单，先去新建一张</option> : null}
            {quotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.quoteNo} · {q.customerName} / {q.eventName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="数量" htmlFor="aq-qty" hint="按比价基准单位填；进单后还能改。">
          <Input
            id="aq-qty"
            inputMode="decimal"
            className="num"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={{ width: '120px' }}
          />
        </Field>
        {quotes.length > 0 ? (
          <div className="t-xs t-3">
            取价口径跟随这张单的声明（含税 / 不含税），不在这里另选。
          </div>
        ) : null}
        {skipped.length > 0 ? (
          <Note tone="warn">
            <div className="flex flex-col gap-[var(--space-1)]">
              {skipped.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </Note>
        ) : null}
        {error ? <Note tone="danger">{error}</Note> : null}
        <div className="t-2xs t-3">
          共 {items.length} 项，其中{' '}
          {items.filter((i) => (i.lowestSummary?.groups.length ?? 0) === 1).length} 项能自动取到价
          {items[0]?.lowestSummary?.groups[0]
            ? ` · 例：${groupLabel(items[0].lowestSummary.groups[0].pricingNature, items[0].lowestSummary.groups[0].pricingMode, items[0].itemType)} ${formatMoney(items[0].lowestSummary.groups[0].groupLowest, { symbol: true })}`
            : ''}
        </div>
      </div>
    </Modal>
  );
}
