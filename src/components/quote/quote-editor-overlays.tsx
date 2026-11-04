'use client';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { ItemDetail, QuoteDetail, QuoteItem, RiskCheckResult, TaxBasis } from '@/lib/types';
import { Toast } from '@/components/ui/overlay';
import { PriceEntryDrawer } from '@/components/price-entry-drawer';
import { LineSupplierModal } from './line-supplier-modal';
import { TaxSwitchModal } from './tax-switch-modal';
import { RiskModal } from './risk-modal';
import { linePatchBody } from './quote-shared';

type Tone = 'success' | 'warn' | 'danger';
type ToastAction = { label: string; onClick: () => void };

/**
 * 编辑器上的全部浮层（换供应商 / 切口径 / 出单自检 / 提示条）。
 *
 * 单独一个文件，是因为这四层回答的是同一个问题——「刚才那个动作要付什么代价」。
 * 口径弹层必须先给出前后合计，自检弹层必须先列出要吞下的风险，
 * 收敛在一处，才不会被谁顺手加一个「不再提示」的勾选框绕过去。
 */
export function QuoteEditorOverlays({
  quote,
  risk,
  mutate,
  reload,
  say,
  supplierFor,
  setSupplierFor,
  taxTarget,
  setTaxTarget,
  riskOpen,
  setRiskOpen,
  issuing,
  issue,
  undoMs,
  recreateItem,
  setRecreateItem,
  onRecreated,
  toast,
  toastTone,
  toastAction,
  clearToast,
}: {
  quote: QuoteDetail;
  risk: RiskCheckResult | null;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
  say: (message: string, tone?: Tone, action?: ToastAction) => void;
  supplierFor: QuoteItem | null;
  setSupplierFor: (line: QuoteItem | null) => void;
  taxTarget: TaxBasis | null;
  setTaxTarget: (b: TaxBasis | null) => void;
  riskOpen: boolean;
  setRiskOpen: (open: boolean) => void;
  issuing: boolean;
  issue: () => void;
  undoMs: number;
  /** 「按旧价重新录价」载入的品；null = 抽屉关着 */
  recreateItem: ItemDetail | null;
  setRecreateItem: (item: ItemDetail | null) => void;
  onRecreated: () => void;
  toast: string | null;
  toastTone: Tone;
  toastAction: ToastAction | null;
  clearToast: () => void;
}) {
  const [taxBusy, setTaxBusy] = useState(false);

  return (
    <>
      <LineSupplierModal
        open={Boolean(supplierFor)}
        line={supplierFor}
        taxBasis={quote.taxStatement}
        onClose={() => setSupplierFor(null)}
        onPick={(payload) => {
          if (!supplierFor) return;
          const line = supplierFor;
          setSupplierFor(null);
          void mutate(() =>
            api.updateQuoteItem(quote.id, line.id, {
              ...linePatchBody(line, { costSource: 'price_book', costUnitPrice: payload.costUnitPrice }),
              priceId: payload.priceId,
              supplierId: payload.supplierId,
              supplierNameSnapshot: payload.supplierName,
            }),
          );
        }}
      />

      <TaxSwitchModal
        open={taxTarget !== null}
        quote={quote}
        to={taxTarget ?? 'inclusive'}
        confirming={taxBusy}
        onClose={() => setTaxTarget(null)}
        onConfirm={async () => {
          if (!taxTarget) return;
          setTaxBusy(true);
          try {
            await api.updateQuote(quote.id, { taxStatement: taxTarget });
            await reload();
            setTaxTarget(null);
          } catch (e) {
            say(errorMessage(e), 'danger');
          } finally {
            setTaxBusy(false);
          }
        }}
      />

      <RiskModal
        open={riskOpen}
        quote={quote}
        risk={risk}
        issuing={issuing}
        onClose={() => setRiskOpen(false)}
        onGoFillCustomer={() => {
          setRiskOpen(false);
          say('在单头把「客户」填上，存一次就能出单了。', 'warn');
        }}
        onConfirm={issue}
      />

      {/* 录价抽屉只在有品时挂载：每次都是干净的表单，不会带着上一行的价格进来 */}
      {recreateItem ? (
        <PriceEntryDrawer
          open
          item={recreateItem}
          onClose={() => setRecreateItem(null)}
          onSaved={() => {
            setRecreateItem(null);
            onRecreated();
          }}
        />
      ) : null}

      <Toast
        message={toast}
        tone={toastTone}
        // 有「撤销」时撑满承诺的 5 秒；没有撤销的普通提示 4 秒就走
        duration={toastAction ? undoMs : undefined}
        onClose={clearToast}
        action={toastAction ?? undefined}
      />
    </>
  );
}
