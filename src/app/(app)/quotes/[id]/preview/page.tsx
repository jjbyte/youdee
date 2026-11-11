'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { CompanyProfile, QuoteDetail } from '@/lib/types';
import { useMe } from '@/lib/use-me';
import { canExportInternal } from '@/domain/permissions';
import { SHEET_OPTIONS_DEFAULT, buildCustomerSheet, type SheetOptions } from '@/domain/customer-sheet';
import { PaperSheet } from '@/components/quote/paper-sheet';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Note } from '@/components/ui/states';
import { ErrorState, InlineLoading } from '@/components/ui/states';
import { IconArrowLeft, IconLock, IconPrinter } from '@/components/icons';

/**
 * 客户版预览（§C.8）。
 *
 * **这一页只有客户版，没有成本开关。**
 * 客户版是服务端从 `CustomerQuoteDTO` 重新渲染的文件，不是"屏幕上这版藏掉几列"。
 * 只要这一页出现任何一个"隐藏成本"的勾选框，就说明又回到了 flag 思维——那是错的。
 *
 * 右侧四个排版选项只影响版式，没有一个是关于成本的。
 * 「不在客户版显示」的行在这里**看不到**——不是灰掉，是不存在。
 */
export default function QuotePreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user } = useMe();
  const isAdmin = user ? canExportInternal(user.role) : false;

  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layout, setLayout] = useState<'detailed' | 'brief'>('detailed');
  const [showUnitPrice, setShowUnitPrice] = useState(true);
  const [showDiscount, setShowDiscount] = useState(true);
  const [grouped, setGrouped] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [q, c] = await Promise.all([api.quote(id), api.company().catch(() => null)]);
      setQuote(q);
      setCompany(c);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 从编辑页「导出客户版 PDF」进来时直接调起打印
  useEffect(() => {
    // ?print=1 只在挂载后读：useSearchParams 在构建期要求 Suspense 边界，
    // 否则整条 /quotes/[id]/preview 会退回纯客户端渲染。
    if (new URLSearchParams(window.location.search).get('print') !== '1' || loading) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [loading]);

  // 版式选项 → 一份 sheet；打印、PDF、Excel 三条路都用它
  const sheetOptions: SheetOptions = useMemo(
    () => ({ ...SHEET_OPTIONS_DEFAULT, layout, grouped, showUnitPrice, showDiscount }),
    [layout, grouped, showUnitPrice, showDiscount],
  );

  /** 建单时选了带 Excel 版式的模板：列已经定死，两个列相关开关失效 */
  const hasCustomLayout = !!quote?.templateLayout;

  const sheet = useMemo(() => {
    if (!quote) return null;
    return buildCustomerSheet(
      {
        quoteNo: quote.quoteNo,
        version: quote.version,
        customerName: quote.customerName,
        eventName: quote.eventName,
        eventDate: quote.eventDate,
        validUntil: quote.validUntil,
        taxStatement: quote.taxStatement,
        discountAmount: quote.discountAmount,
        totalPrice: quote.totalPrice,
        note: quote.note,
        supplierName: quote.templateSupplierName,
        quoteDate: quote.quoteDate,
        operatorName: quote.createdByName,
        operatorPhone: quote.createdByPhone,
        items: quote.items
          .filter((l) => l.isVisibleToCustomer)
          .map((l) => ({
            name: l.itemNameSnapshot,
            spec: l.specSnapshot,
            unit: l.unitSnapshot,
            qty: String(l.qty),
            unitPrice: String(l.saleUnitPrice),
            amount: String(l.linePrice),
            remark: l.remark,
            category: l.categorySnapshot,
          })),
      },
      company ?? {},
      sheetOptions,
      // 建单时快照的版式；没有就是系统默认版式
      quote.templateLayout ?? null,
    );
  }, [quote, company, sheetOptions]);

  if (loading && !quote) {
    return (
      <div className="page">
        <InlineLoading label="正在排客户版…" />
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!quote || !sheet) return null;

  return (
    <div className="page flex flex-col gap-[var(--space-5)]">
      <div className="no-print flex items-center gap-[var(--space-3)] flex-wrap">
        <Link href={`/quotes/${quote.id}/edit`} className="btn btn--icon" aria-label="返回编辑">
          <IconArrowLeft size={16} />
        </Link>
        <h1 className="t-lg">
          预览 · 客户版 <span className="num t-3 t-md">{quote.quoteNo}</span>
        </h1>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" icon={<IconPrinter size={16} />} onClick={() => window.print()}>
          打印
        </Button>
      </div>

      <div className="flex items-start gap-[var(--space-6)] flex-wrap">
        {/* 左：A4 纸面。与客户版 Excel 同一份 model，不再各画一套表 */}
        <div className="paper-wrap flex-1 min-w-[520px]">
          <PaperSheet sheet={sheet} />
        </div>

        {/* 右：排版选项（没有一个选项与成本有关） */}
        <aside className="no-print flex flex-col gap-[var(--space-4)]" style={{ width: 300, flex: 'none' }}>
          <div className="panel">
            <div className="fw-semi t-sm mb-[var(--space-3)]">客户版排版</div>

            <div className="flex flex-col gap-[var(--space-4)]">
              {/*
                列集合由建单时选的模板决定后，「详细/精简」与「显示单价」就不再是开关：
                模板里没有单价列，勾了也不该冒出来。这里置灰并说明原因，而不是把开关藏掉——
                藏掉会让人以为功能丢了。
              */}
              <div className="flex flex-col gap-[var(--space-2)]">
                <span className="label">版式</span>
                <Segmented<'detailed' | 'brief'>
                  ariaLabel="版式"
                  value={layout}
                  options={[
                    { value: 'detailed', label: '详细' },
                    { value: 'brief', label: '精简' },
                  ]}
                  onChange={setLayout}
                />
                {hasCustomLayout ? (
                  <span className="t-2xs t-3">列由这份报价单的模板决定，这里的版式选择不生效。</span>
                ) : null}
              </div>

              <label className="inline-flex items-center gap-[var(--space-2)] t-sm">
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                按分类分组
              </label>

              <label
                className={
                  hasCustomLayout
                    ? 'inline-flex items-center gap-[var(--space-2)] t-sm t-3'
                    : 'inline-flex items-center gap-[var(--space-2)] t-sm'
                }
              >
                <input
                  type="checkbox"
                  checked={showUnitPrice}
                  disabled={hasCustomLayout}
                  onChange={(e) => setShowUnitPrice(e.target.checked)}
                />
                显示单价
                {hasCustomLayout ? <span className="t-2xs">（模板没这一列）</span> : null}
              </label>

              <label className="inline-flex items-center gap-[var(--space-2)] t-sm">
                <input
                  type="checkbox"
                  checked={showDiscount}
                  onChange={(e) => setShowDiscount(e.target.checked)}
                />
                显示原价与折后
              </label>

              <div className="t-2xs t-3">{sheet.taxLine}</div>
            </div>
          </div>

          <div className="flex flex-col gap-[var(--space-2)]">
            <Button
              variant="primary"
              onClick={() => window.print()}
            >
              导出客户版 PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = api.exportXlsxUrl(quote.id, 'customer', {
                  layout,
                  grouped,
                  unitPrice: showUnitPrice,
                  discount: showDiscount,
                });
              }}
            >
              导出客户版 Excel
            </Button>
            <div className="h-px bg-[var(--border)] my-[var(--space-2)]" />
            <Button
              variant="secondary"
              disabled={!isAdmin}
              icon={!isAdmin ? <IconLock size={16} /> : undefined}
              title={!isAdmin ? '内部版含成本，仅管理员可导出' : undefined}
              onClick={() => {
                window.location.href = api.exportXlsxUrl(quote.id, 'internal');
              }}
            >
              导出内部版（含成本）
            </Button>
            {!isAdmin ? <div className="t-2xs t-3">内部版含成本，仅管理员可导出</div> : null}
          </div>

          <Note tone="neutral">
            这一页只有客户版。成本、毛利、参考最低价都不会出现在这里——它们在服务端就被剔掉了，不是被藏起来。
          </Note>

          <div className="t-2xs t-3">
            客户版 PDF 走浏览器打印（A4、正文 12pt）。要改内容
            <button type="button" className="btn btn--link" onClick={() => router.push(`/quotes/${quote.id}/edit`)}>
              回编辑页
            </button>
            。
          </div>
        </aside>
      </div>
    </div>
  );
}
