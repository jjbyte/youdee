'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage, isUnauthorized } from '@/lib/api';
import type { QuoteDetail, QuoteItem, RiskCheckResult, TaxBasis } from '@/lib/types';
import { useMe } from '@/lib/use-me';
import { canExportInternal } from '@/domain/permissions';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { QuoteHeader } from '@/components/quote/quote-header';
import { QuoteLinesPanel } from '@/components/quote/quote-lines-panel';
import { QuoteFootbar } from '@/components/quote/quote-footbar';
import { PickerPanel } from '@/components/quote/picker-panel';
import { QuoteEditorOverlays } from '@/components/quote/quote-editor-overlays';
import { useEditorKeys } from '@/components/quote/use-editor-keys';
import { useQuoteLines } from '@/components/quote/use-quote-lines';
import { linePatchBody } from '@/components/quote/quote-shared';

const UNDO_MS = 5000;
/** 空集合常量：键盘层的"当前行"只认焦点，不认勾选（勾选归明细面板管） */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * 报价单编辑器（§C.7）—— 核心页。
 *
 * 三条不能破的：
 *   ① **阻断唯一条件 = 有行没成本**（costUnitPrice 为 null 或 ≤ 0）。
 *      负毛利 / 软陈旧 / 非最低价**永不阻断**——阻断会逼用户回 Excel 出单，那比亏钱更糟。
 *   ② 口径是真开关（resolvePrice 的入参）：切换必须先看 preview 的前后合计，再落库。
 *   ③ 已发出的单转只读。不做"提示了但允许改"——快照不变性是对外报价的信任基础。
 */
export default function QuoteEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user } = useMe();
  const isAdmin = user ? canExportInternal(user.role) : false;

  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [risk, setRisk] = useState<RiskCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [supplierFor, setSupplierFor] = useState<QuoteItem | null>(null);
  const [taxTarget, setTaxTarget] = useState<TaxBasis | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'warn' | 'danger'>('success');
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(null);

  /** 一条提示 = 一句话 + 一个语气。绿勾配「这次没成」是最刺眼的一种错。 */
  const say = useCallback((message: string, tone: 'success' | 'warn' | 'danger' = 'success', action?: { label: string; onClick: () => void }) => {
    setToast(message);
    setToastTone(tone);
    setToastAction(action ?? null);
  }, []);

  const locked = quote ? quote.status !== 'draft' : false;

  const reload = useCallback(
    async (showSpinner = false) => {
      if (!id) return;
      if (showSpinner) setLoading(true);
      try {
        const q = await api.quote(id);
        setQuote(q);
        setError(null);
        // 自检结果只用来给行上色（软陈旧、负毛利、对客价为 0），失败不影响编辑
        api
          .riskCheck(id)
          .then(setRisk)
          .catch(() => setRisk(null));
      } catch (e) {
        if (isUnauthorized(e)) {
          router.replace('/login');
          return;
        }
        setError(errorMessage(e));
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [id, router],
  );

  useEffect(() => {
    void reload(true);
  }, [reload]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setSaveState('saving');
      try {
        await fn();
        await reload();
        setSaveState('idle');
      } catch (e) {
        setSaveState('error');
        setError(errorMessage(e));
      }
    },
    [reload],
  );

  const {
    flagsOf,
    missingCount,
    staleCount,
    manualCount,
    lineById,
    addItems,
    deleteLine,
    moveLine,
    duplicateLine,
    recreateItem,
    setRecreateItem,
    startRecreate,
    afterRecreated,
  } = useQuoteLines({ quote, risk, mutate, reload, say, undoMs: UNDO_MS });


  async function issue() {
    if (!quote) return;
    setIssuing(true);
    try {
      const next = await api.issueQuote(quote.id);
      setQuote(next);
      setRiskOpen(false);
      say(`报价单已生成 ${next.quoteNo}。客户版可以在预览页打印或导出。`);
    } catch (e) {
      say(errorMessage(e), 'danger');
      setRiskOpen(false);
    } finally {
      setIssuing(false);
    }
  }

  useEditorKeys({
    lineIds: quote?.items.map((l) => l.id) ?? [],
    // 键盘层的"当前行"优先取焦点所在行；没有被勾选的概念由面板自己管
    selectedIds: EMPTY_IDS,
    // 只读单、或任何一个弹窗打开时，键盘全部让位
    enabled: Boolean(quote) && !locked && !riskOpen && taxTarget === null && supplierFor === null,
    canUndo: toastAction !== null,
    onDuplicate: (lineId) => {
      const line = lineById(lineId);
      if (line) duplicateLine(line);
    },
    onMove: (lineId, dir) => void moveLine(lineId, dir),
    onDelete: (lineId) => {
      const line = lineById(lineId);
      if (line) deleteLine(line);
    },
    onUndo: () => {
      toastAction?.onClick();
      setToast(null);
      setToastAction(null);
    },
    onIssue: () => setRiskOpen(true),
    onPreview: () => router.push(`/quotes/${quote?.id ?? id}/preview`),
    onAutosaveHint: () => say('每次改动都已经存了，不用按这个。'),
  });

  if (loading && !quote) {
    return (
      <div className="page">
        <InlineLoading label="正在打开这张单…" />
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void reload(true)} retryLabel="重新打开" />
      </div>
    );
  }

  if (!quote) return null;

  return (
    <div className="page flex flex-col gap-[var(--space-4)]" style={{ minHeight: 'calc(100dvh - var(--topbar-h))' }}>
      <QuoteHeader
        quote={quote}
        saveState={saveState}
        onRetrySave={() => void reload()}
        isAdmin={isAdmin}
        locked={locked}
        onPatch={(body) => void mutate(() => api.updateQuote(quote.id, body))}
        onTaxBasis={(b) => setTaxTarget(b)}
        onPreview={() => router.push(`/quotes/${quote.id}/preview`)}
        onNewVersion={() =>
          void mutate(async () => {
            const next = await api.newVersion(quote.id, true);
            router.push(`/quotes/${next.id}/edit`);
          })
        }
        onExport={(view) => {
          if (view === 'customer-xlsx') window.location.href = api.exportXlsxUrl(quote.id, 'customer');
          else if (view === 'internal') window.location.href = api.exportXlsxUrl(quote.id, 'internal');
          else router.push(`/quotes/${quote.id}/preview?print=1`);
        }}
      />

      {error && quote ? (
        <Note tone="danger">
          {error}{' '}
          <button type="button" className="btn btn--link" onClick={() => void reload()}>
            再试一次
          </button>
        </Note>
      ) : null}

      <div className="editor flex-1">
        <PickerPanel
          disabled={locked}
          onAdd={(items) => void addItems(items)}
          onToast={(m) => say(m, 'warn')}
        />

        <QuoteLinesPanel
          items={quote.items}
          locked={locked}
          flagsOf={flagsOf}
          onPatch={(line, changes) =>
            void mutate(() => api.updateQuoteItem(quote.id, line.id, linePatchBody(line, changes)))
          }
          onDuplicate={duplicateLine}
          onDelete={deleteLine}
          onPickSupplier={setSupplierFor}
          onRecreatePrice={(line) => void startRecreate(line)}
          onAddLine={() => {
            // 添加行 = 把光标送进左边的搜索框。不跳页：一跳走就得重新找这张单。
            const input = document.querySelector<HTMLInputElement>('[data-picker-search] input');
            input?.focus();
            input?.select();
          }}
          onCopyLastYear={() => {
            // 这张单不能合并另一张单的行（服务端只支持"整单派生新版本"），
            // 所以按钮只负责把人送到能干活的地方，并在目的地完成任务。
            router.push('/quotes?status=issued');
          }}
          onBulkDelete={(ids) => {
            void mutate(async () => {
              for (const lineId of ids) await api.deleteQuoteItem(quote.id, lineId);
            });
            say(`删掉 ${ids.length} 行。`, 'warn');
          }}
        />
      </div>

      <QuoteFootbar
        quote={quote}
        missingCount={missingCount}
        staleCount={staleCount}
        manualCount={manualCount}
        issuing={issuing}
        locked={locked}
        onDiscount={(amount) => void mutate(() => api.updateQuote(quote.id, { discountAmount: amount }))}
        onIssue={() => setRiskOpen(true)}
      />

      <QuoteEditorOverlays
        quote={quote}
        risk={risk}
        mutate={mutate}
        reload={reload}
        say={say}
        supplierFor={supplierFor}
        setSupplierFor={setSupplierFor}
        taxTarget={taxTarget}
        setTaxTarget={setTaxTarget}
        riskOpen={riskOpen}
        setRiskOpen={setRiskOpen}
        issuing={issuing}
        issue={() => void issue()}
        undoMs={UNDO_MS}
        recreateItem={recreateItem}
        setRecreateItem={setRecreateItem}
        onRecreated={() => void afterRecreated()}
        toast={toast}
        toastTone={toastTone}
        toastAction={toastAction}
        clearToast={() => {
          setToast(null);
          setToastAction(null);
        }}
      />
    </div>
  );
}
