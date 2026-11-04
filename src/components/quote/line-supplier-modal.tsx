'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, formatQty } from '@/lib/format';
import { supplierTypeLabel, unitLabel } from '@/lib/labels';
import type { CompareResult, QuoteItem, TaxBasis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note, InlineLoading } from '@/components/ui/states';
import { rankRows } from '@/lib/compare-local';

/**
 * 换供应商（§C.7 v1.1 修正第 5 条）。
 *
 * 成本单价可点开换一家——报价员可能知道便宜那家做不出来、交不了期、或者上次惹过客户。
 * 所以这里**只列出来并说出差价，不替他决策、不自动换成最低**。
 */
export function LineSupplierModal({
  open,
  line,
  taxBasis,
  onClose,
  onPick,
}: {
  open: boolean;
  line: QuoteItem | null;
  taxBasis: TaxBasis;
  onClose: () => void;
  onPick: (payload: { priceId: string; supplierId: string; supplierName: string; costUnitPrice: string }) => void;
}) {
  const [data, setData] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !line?.itemId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .compare(line.itemId, {
        qty: line.qty,
        taxBasis,
        pricingNature: line.pricingNature ?? undefined,
      })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, line?.itemId, line?.qty, line?.pricingNature, taxBasis]);

  const cmpUnit = unitLabel(data?.item.compareUnitCode ?? data?.item.baseUnitCode, data?.item.baseUnitName);
  const rows = (data?.groups ?? []).flatMap((g) => rankRows(g.rows, taxBasis, Number(line?.qty ?? 1)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`换供应商 · ${line?.itemNameSnapshot ?? ''}`}
      width="620px"
      footer={
        <Button variant="ghost" onClick={onClose}>
          不改了
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--space-3)]">
        <p className="t-xs t-3">
          只列同性质、同口径、能比的价。贵的也列出来——最终用哪家是商务判断，系统不替你选。
        </p>
        {loading ? <InlineLoading label="正在读这家的各家价…" /> : null}
        {error ? <Note tone="danger">{error}</Note> : null}
        {!loading && !error && rows.length === 0 ? (
          <Note tone="neutral">这个物料在这个性质下还没有能比的价。先去比价页录一条。</Note>
        ) : null}

        {rows.map((r) => {
          const price = r.exclusive === 'UNIT_NOT_COMPARABLE' ? r.hit.unitPrice : r.hit.baseUnitPrice;
          const same = r.row.priceId === line?.priceId;
          return (
            <button
              key={r.row.priceId}
              type="button"
              className="panel w-full text-left"
              disabled={r.exclusive !== null}
              onClick={() =>
                onPick({
                  priceId: r.row.priceId,
                  supplierId: r.row.supplierId,
                  supplierName: r.row.supplierName,
                  costUnitPrice: String(price ?? ''),
                })
              }
            >
              <div className="flex items-center gap-[var(--space-3)]">
                <span className="t-sm truncate flex-1">{r.row.supplierName}</span>
                <span className="t-2xs t-3">{supplierTypeLabel(r.row.supplierType)}</span>
                {r.isLowest ? <Badge tone="lowest">最低</Badge> : null}
                {same ? <Badge tone="info">当前用的</Badge> : null}
                <span className="num t-sm fw-med">
                  {formatMoney(price, { symbol: true })}
                  <span className="t-2xs t-3">/{cmpUnit}</span>
                </span>
              </div>
              <div className="t-2xs t-3 mt-[var(--space-1)]">
                {r.row.taxIncluded ? '含税' : '不含税'}
                {r.row.moq ? ` · 起订 ${formatQty(r.row.moq)}` : ''}
                {r.hit.tierCase === 'in_tier' && r.hit.range ? ` · 命中 ${r.hit.range} 档` : ''}
                {r.exclusive === 'UNIT_NOT_COMPARABLE' ? ' · 单位不一致，不能直接比' : ''}
                {r.row.effectiveTo ? ` · 有效到 ${r.row.effectiveTo}` : ' · 长期有效'}
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
