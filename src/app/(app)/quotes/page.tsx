'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { cx, formatDate, formatMoney, formatRate, formatTimeRel } from '@/lib/format';
import { PROJECT_TYPE_LABELS, PROJECT_TYPE_ORDER, QUOTE_STATUS_LABELS } from '@/lib/labels';
import type { Page, QuoteListItem, QuoteStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput, Select } from '@/components/ui/field';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ConfirmModal, type ConfirmSpec } from '@/components/ui/confirm-modal';
import { Toast } from '@/components/ui/overlay';
import { NewQuoteButton } from '@/components/new-quote-button';
import { useMe } from '@/lib/use-me';
import { canDeleteRecord } from '@/domain/permissions';
import { IconQuote } from '@/components/icons';

const PAGE_SIZE = 20;

/**
 * 报价单列表（§C.8）。
 *
 * 状态只有三态，**「已作废」默认不列**——作废单留在默认列表里会稀释台账的可信度；
 * 但它不能消失，筛选器里可选中，因为"这单作废了，我重报了"是需要被查证的。
 */
const STATUSES = ['draft', 'issued', 'void'] as const;

export default function QuotesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  // 默认 draft：进列表最想看的永远是「还没做完的」。
  // URL 上带了 status 就认它（工作台的「本月已发出」、编辑页的「复制另一张单」都靠这个跳过来）。
  const [status, setStatus] = useState<'' | QuoteStatus>('draft');
  /**
   * 先等 URL 读完再发第一次请求。否则 ?status=issued 会先进来拉一遍草稿、
   * 再切到已发出拉一遍——用户看到的是一次没必要的闪动，两次都花他的时间。
   * 用 window.location 不用 useSearchParams：后者在构建期要求 Suspense 边界，
   * 否则整条路由退回纯客户端渲染。
   */
  const [urlReady, setUrlReady] = useState(false);
  const [projectType, setProjectType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<QuoteListItem> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { user } = useMe();
  const isAdmin = user ? canDeleteRecord(user.role) : false;
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [list, drafts, issued] = await Promise.all([
        api.quotes({
          q: q.trim() || undefined,
          status: status || undefined,
          projectType: projectType || undefined,
          page,
          limit: PAGE_SIZE,
        }),
        api.quotes({ status: 'draft', limit: 1 }).catch(() => null),
        api.quotes({ status: 'issued', limit: 1 }).catch(() => null),
      ]);
      setData(list);
      setCounts({ draft: drafts?.total ?? 0, issued: issued?.total ?? 0 });
      setState('ready');
    } catch (e) {
      setError(errorMessage(e));
      setState('error');
    }
  }, [q, status, projectType, page]);

  // ① 先把 URL 上的筛选读进来（只读一次） ② 读完再发请求
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s && (STATUSES as readonly string[]).includes(s)) setStatus(s as QuoteStatus);
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    void load();
  }, [load, urlReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && el?.tagName !== 'INPUT' && el?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const afterChange = async (message: string) => {
    setConfirm(null);
    setToast(message);
    await load();
  };

  /** 作废：成员也能做。草稿与已发出都能作废——草稿不能作废的话，成员建错一张单就永远清不掉 */
  const askVoid = (r: QuoteListItem) =>
    setConfirm({
      title: `作废 ${r.quoteNo}？`,
      body: (
        <>
          作废后这张单不再出现在{QUOTE_STATUS_LABELS[r.status]}里，挪到「已作废」筛选下。
          {r.status === 'issued' ? '客户手里那份不受影响——它已经在客户手上了。' : ''}
        </>
      ),
      warn: '作废随时能恢复。恢复后回到作废前的状态，金额和行明细都不会变。',
      confirmLabel: '作废',
      run: async () => {
        await api.voidQuote(r.id);
        await afterChange(`${r.quoteNo} 已作废。要反悔就点「恢复」。`);
      },
    });

  const askRestore = (r: QuoteListItem) =>
    setConfirm({
      title: `恢复 ${r.quoteNo}？`,
      body:
        r.issuedAt !== null
          ? '这张单当年真的发给过客户，恢复后回到「已发出」。'
          : '这张单从来没发出过，恢复后回到「草稿」，可以接着编。',
      warn: '恢复只改状态，金额和行明细都不变。',
      confirmLabel: '恢复',
      tone: 'primary',
      run: async () => {
        await api.restoreQuote(r.id);
        await afterChange(`${r.quoteNo} 已恢复。`);
      },
    });

  const askDelete = (r: QuoteListItem) =>
    setConfirm({
      title: `删掉 ${r.quoteNo}？`,
      body: (
        <>
          删掉后这张单从所有列表里消失，<span className="fw-semi">不会再回来</span>。
        </>
      ),
      warn: '删除不可恢复。如果只是这单不做了，用「作废」更合适——作废能恢复，而且台账还在。',
      confirmLabel: '确认删掉',
      run: async () => {
        await api.deleteQuote(r.id);
        await afterChange(`${r.quoteNo} 已删除。`);
      },
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">报价单</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            单子只记三态：草稿、已发出、已作废。发出后不能改，只能复制重报——这样客户手里那份和系统里那份才永远一样。
          </p>
        </div>
        <NewQuoteButton />
      </div>

      <div className="flex items-center gap-[var(--space-3)] flex-wrap mt-[var(--space-5)]">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="搜单号 / 客户 / 活动名"
          ariaLabel="搜索报价单"
          inputRef={searchRef}
          className="min-w-[260px]"
        />
        <Select
          value={status}
          aria-label="状态筛选"
          style={{ width: 148 }}
          onChange={(e) => {
            setStatus(e.target.value as '' | QuoteStatus);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="draft">草稿{counts.draft ? `（${counts.draft}）` : ''}</option>
          <option value="issued">已发出{counts.issued ? `（${counts.issued}）` : ''}</option>
          <option value="void">已作废</option>
        </Select>
        <Select
          value={projectType}
          aria-label="项目类型筛选"
          style={{ width: 168 }}
          onChange={(e) => {
            setProjectType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部类型</option>
          {PROJECT_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {PROJECT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>

        <span className="ml-auto t-xs t-3">
          草稿 <span className="num">{counts.draft ?? 0}</span> · 已发出{' '}
          <span className="num">{counts.issued ?? 0}</span>
          {/* 原来这里硬编码了「已作废 5 张」，删了几张之后这句话一直在骗人 */}
          {status === 'void' ? null : <span> · 已作废的单在筛选里看</span>}
        </span>
      </div>

      <div className="mt-[var(--space-4)]">
        {state === 'loading' ? <TableSkeleton rows={8} cols={6} /> : null}
        {state === 'error' ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {state === 'ready' && rows.length === 0 ? (
          <EmptyState
            icon={<IconQuote size={24} />}
            title={q ? `没找到「${q}」。` : '还没有报价单。'}
            body={q ? '试试单号后三位，或者换个客户名。' : '开一张草稿单，从物料库里往里攒东西——攒的时候会自动取当天的价。'}
          />
        ) : null}

        {state === 'ready' && rows.length > 0 ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>单号</Th>
                    <Th>客户 / 活动</Th>
                    <Th>状态</Th>
                    <Th align="right">对客合计</Th>
                    <Th align="right">毛利率</Th>
                    <Th align="right">项数</Th>
                    <Th>最后编辑</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(r.status === 'draft' ? `/quotes/${r.id}/edit` : `/quotes/${r.id}/preview`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Td>
                        <span className="num t-sm">{r.quoteNo}</span>
                        {r.version > 1 ? <span className="t-2xs t-3 ml-[var(--space-1)]">v{r.version}</span> : null}
                      </Td>
                      <Td>
                        <div className="truncate">{r.customerName || '（客户没填）'}</div>
                        <span className="cell-sub truncate">{r.eventName}</span>
                      </Td>
                      <Td>
                        <Badge
                          tone={r.status === 'issued' ? 'success' : r.status === 'void' ? 'neutral' : 'info'}
                        >
                          {QUOTE_STATUS_LABELS[r.status]}
                        </Badge>
                        {r.isExpired && r.status === 'draft' ? (
                          <Badge tone="warn" className="ml-[var(--space-1)]">
                            有效期已过
                          </Badge>
                        ) : null}
                      </Td>
                      <Td align="right">
                        <span className="num">{formatMoney(r.totalPrice, { symbol: true })}</span>
                      </Td>
                      <Td align="right">
                        <span className={cx('num', Number(r.marginRate ?? 0) < 0 && 't-danger')}>
                          {formatRate(r.marginRate)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="num t-3">{r.itemCount}</span>
                      </Td>
                      <Td>
                        <span className="t-xs t-3">{formatTimeRel(r.updatedAt ?? r.createdAt)}</span>
                        {r.eventDate ? <span className="cell-sub">活动 {formatDate(r.eventDate)}</span> : null}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-[var(--space-3)]">
                          <Link
                            href={r.status === 'draft' ? `/quotes/${r.id}/edit` : `/quotes/${r.id}/preview`}
                            className="btn btn--link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.status === 'draft' ? '继续编' : '看客户版'}
                          </Link>
                          {r.status === 'void' ? (
                            <button
                              type="button"
                              className="btn btn--link"
                              onClick={(e) => {
                                e.stopPropagation();
                                askRestore(r);
                              }}
                            >
                              恢复
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--link"
                              onClick={(e) => {
                                e.stopPropagation();
                                askVoid(r);
                              }}
                            >
                              作废
                            </button>
                          )}
                          {isAdmin ? (
                            <button
                              type="button"
                              className="btn btn--link t-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                askDelete(r);
                              }}
                            >
                              删除
                            </button>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <div className="tbl-foot">
              <span>
                共 <span className="num">{total}</span> 张
              </span>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <span className="num t-xs t-3">
                {page} / {pages}
              </span>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
