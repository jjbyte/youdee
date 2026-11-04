'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { CompanyProfile, QuoteDetail, QuoteItem } from '@/lib/types';
import { useMe } from '@/lib/use-me';
import { canExportInternal } from '@/domain/permissions';
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

  const visible = useMemo(() => (quote ? quote.items.filter((l) => l.isVisibleToCustomer) : []), [quote]);

  const groups = useMemo(() => {
    if (!grouped) return [{ key: 'all', title: '', lines: visible }];
    const map = new Map<string, QuoteItem[]>();
    for (const l of visible) {
      const k = l.categorySnapshot?.trim() || '其他';
      const arr = map.get(k);
      if (arr) arr.push(l);
      else map.set(k, [l]);
    }
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    return Array.from(map.entries()).map(([k, lines], i) => ({
      key: k,
      title: `${CN[i] ?? String(i + 1)}、${k}`,
      lines,
    }));
  }, [visible, grouped]);

  const total = visible.reduce((a, l) => a + Number(l.linePrice), 0);

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

  if (!quote) return null;

  const taxLine =
    quote.taxStatement === 'inclusive' ? '以上报价为含税价，税率另计' : '以上报价为不含税价，税额另计';

  return (
    <div className="page flex flex-col gap-[var(--space-5)]">
      <div className="flex items-center gap-[var(--space-3)] flex-wrap">
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
        {/* 左：A4 纸面（服务端 CustomerQuoteDTO 的渲染色样） */}
        <div className="flex-1 min-w-[520px]">
          <div className="paper">
            <h1>{company?.name ?? '（公司名没配）'}</h1>
            <div className="paper-sub">
              {quote.eventName}活动报价 · 单号 {quote.quoteNo}
            </div>

            <div className="t-sm" style={{ marginBottom: 'var(--space-5)' }}>
              <div>
                客户：{quote.customerName || '（客户名没填）'}
                {quote.eventDate ? `　　活动日期：${formatDate(quote.eventDate)}` : ''}
              </div>
              <div className="t-3 t-xs" style={{ marginTop: 'var(--space-1)' }}>
                报价有效期至 {formatDate(quote.validUntil)}
              </div>
            </div>

            <table className="paper-tbl">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  {layout === 'detailed' ? <th scope="col">规格</th> : null}
                  <th scope="col">单位</th>
                  <th scope="col" className="num">
                    数量
                  </th>
                  {showUnitPrice ? (
                    <th scope="col" className="num">
                      单价
                    </th>
                  ) : null}
                  <th scope="col" className="num">
                    金额
                  </th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  {g.title ? (
                    <tr>
                      <td colSpan={layout === 'detailed' ? (showUnitPrice ? 6 : 5) : showUnitPrice ? 5 : 4} className="fw-semi">
                        {g.title}
                      </td>
                    </tr>
                  ) : null}
                  {g.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.itemNameSnapshot}
                        {layout === 'detailed' && l.remark ? <span className="t-3 t-2xs">（{l.remark}）</span> : null}
                      </td>
                      {layout === 'detailed' ? <td>{l.specSnapshot ?? '—'}</td> : null}
                      <td>{l.unitSnapshot}</td>
                      <td className="num">{l.qty}</td>
                      {showUnitPrice ? <td className="num">{formatMoney(l.saleUnitPrice)}</td> : null}
                      <td className="num">{formatMoney(l.linePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>

            <div className="paper-total">
              {showDiscount && Number(quote.discountAmount) > 0 ? (
                <span className="t-sm t-3 fw-normal">
                  优惠 −{formatMoney(quote.discountAmount, { symbol: true })}
                </span>
              ) : null}
              <span>合计 {formatMoney(showDiscount ? quote.totalPrice : String(total), { symbol: true })}</span>
            </div>

            <div className="paper-foot">
              <div>{taxLine}</div>
              <div>
                报价有效期至 {formatDate(quote.validUntil)}
                {company?.phone ? ` · ${company.phone}` : ''}
                {company?.address ? ` · ${company.address}` : ''}
              </div>
              {quote.note ? <div style={{ marginTop: 'var(--space-2)' }}>{quote.note}</div> : null}
            </div>
          </div>
        </div>

        {/* 右：排版选项（没有一个选项与成本有关） */}
        <aside className="flex flex-col gap-[var(--space-4)]" style={{ width: 300, flex: 'none' }}>
          <div className="panel">
            <div className="fw-semi t-sm mb-[var(--space-3)]">客户版排版</div>

            <div className="flex flex-col gap-[var(--space-4)]">
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
              </div>

              <label className="inline-flex items-center gap-[var(--space-2)] t-sm">
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                按分类分组
              </label>

              <label className="inline-flex items-center gap-[var(--space-2)] t-sm">
                <input
                  type="checkbox"
                  checked={showUnitPrice}
                  onChange={(e) => setShowUnitPrice(e.target.checked)}
                />
                显示单价
              </label>

              <label className="inline-flex items-center gap-[var(--space-2)] t-sm">
                <input
                  type="checkbox"
                  checked={showDiscount}
                  onChange={(e) => setShowDiscount(e.target.checked)}
                />
                显示原价与折后
              </label>

              <div className="t-2xs t-3">{taxLine}</div>
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
                window.location.href = api.exportXlsxUrl(quote.id, 'customer');
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
