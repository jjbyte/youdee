'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage, isUnauthorized } from '@/lib/api';
import type { DashboardSummary } from '@/lib/types';
import { cx, formatMoney, formatStaleDays, formatTimeRel, formatDelta, formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { ErrorState, Note, EmptyState } from '@/components/ui/states';
import { Money } from '@/components/ui/money';
import { NewQuoteButton } from '@/components/new-quote-button';
import { LowestSummaryView } from '@/components/lowest-summary';
import { IconArrowRight, IconExpired, IconRisk } from '@/components/icons';

interface StalePrice {
  priceId: string;
  itemName: string;
  supplierName: string;
  stalenessDays: number;
  effectiveTo: string | null;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '还没睡';
  if (h < 12) return '上午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [stale, setStale] = useState<StalePrice[]>([]);
  const [userName, setUserName] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [d, me] = await Promise.all([api.dashboard(), api.me().catch(() => null)]);
      setData(d);
      setUserName(me?.name ?? '');
      setStatus('ready');
    } catch (e) {
      if (isUnauthorized(e)) {
        router.replace('/login');
        return;
      }
      setError(errorMessage(e));
      setStatus('error');
      return;
    }
    // 第 ③ 块要具体的陈旧价清单，用 /prices/expiring?mode=stale。
    // 这是次要请求，失败就只显示计数，不污染主内容。
    try {
      const res = await fetch('/api/v1/prices/expiring?mode=stale&days=365', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const json = (await res.json()) as { code?: number; data?: StalePrice[] };
      if (json.code === 0 && Array.isArray(json.data)) setStale(json.data.slice(0, 3));
    } catch {
      setStale([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const drafts = useMemo(
    () => (data?.recentQuotes ?? []).filter((q) => q.status === 'draft').slice(0, 3),
    [data],
  );

  if (status === 'error') {
    return (
      <div className="page">
        <ErrorState message={error || '工作台没加载出来。'} onRetry={() => void load()} />
      </div>
    );
  }

  if (status === 'loading' || !data) {
    return (
      <div className="page" aria-busy="true">
        <div className="page-head">
          <div>
            <div className="skeleton" style={{ width: '260px', height: '24px' }} />
            <div className="skeleton mt-[var(--space-3)]" style={{ width: '360px', height: '12px' }} />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div className="skeleton mt-[var(--space-4)]" key={i} style={{ height: '64px' }} />
        ))}
      </div>
    );
  }

  const isEmpty =
    (data.materialCount ?? 0) === 0 && (data.personnelCount ?? 0) === 0 && (data.priceCount ?? 0) === 0;

  const overdueCount = data.overduePriceCount ?? data.expiringPriceCount ?? 0;
  const todoCount =
    (data.draftQuoteCount > 0 ? 1 : 0) +
    (data.hasOverduePrice || overdueCount > 0 ? 1 : 0) +
    (data.stalePriceCount > 0 ? 1 : 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">工作台</h1>
          <div className="page-sub">
            {isEmpty
              ? '库里还是空的，先把常用的几个物料录进来。'
              : `${greeting()}${userName ? `，${userName}` : ''}。今天有 ${todoCount} 件事要处理。`}
          </div>
        </div>
        <NewQuoteButton />
      </div>

      {isEmpty ? (
        <EmptyState
          title="系统还是空的。先建 5 个你天天要报价的物料，比价和出单才能跑起来。"
          body="从最常报的那几个开始：桁架、喷绘布、LED 屏、主持人、兼职礼仪。"
          primary={{ label: '去物料库', href: '/materials' }}
          secondary={{ label: '去人员库', href: '/staff' }}
        />
      ) : (
        <>
          <div className="section-title">待处理</div>
          <div className="panel panel--flush">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {/* ① 草稿 */}
              <Todo
                index="①"
                tone="neutral"
                text={
                  data.draftQuoteCount > 0
                    ? `${data.draftQuoteCount} 张报价单还是草稿，客户在等`
                    : '没有压在手上的草稿单'
                }
                action={{ label: data.draftQuoteCount > 0 ? '去看' : '开一张', href: '/quotes' }}
                detail={
                  drafts.length > 0
                    ? drafts.map((q) => (
                        <div key={q.id} className="flex items-baseline gap-[var(--space-3)] t-sm">
                          <Link href={`/quotes/${q.id}/edit`} className="truncate">
                            {q.eventName}
                          </Link>
                          <span className="t-3">{q.quoteNo}</span>
                          <span className="t-3">最后编辑 {formatTimeRel(q.updatedAt ?? q.createdAt)}</span>
                          <span style={{ flex: 1 }} />
                          <span className="t-3">合计</span>
                          <Money value={q.totalPrice} symbol />
                        </div>
                      ))
                    : null
                }
              />

              {/* ② 已失效（红：用它会出事） */}
              <Todo
                index="②"
                tone="danger"
                icon={<IconExpired size={16} />}
                text={
                  overdueCount > 0
                    ? `${overdueCount} 个价已经失效了，拿它们出单会被拦住`
                    : '没有已失效的价'
                }
                action={{ label: '去处理', href: '/materials' }}
                detail={
                  stale
                    .filter((s) => s.effectiveTo && s.effectiveTo < new Date().toISOString().slice(0, 10))
                    .slice(0, 3)
                    .map((s) => (
                      <div key={s.priceId} className="t-sm t-2">
                        {s.itemName} · {s.supplierName} · {s.effectiveTo} 到期
                      </div>
                    ))
                }
              />

              {/* ③ 软陈旧（琥珀：能用但老了）—— 与 ② 必须分开，混成一块就分不清今天必须做什么 */}
              <Todo
                index="③"
                tone="warn"
                icon={<IconRisk size={16} />}
                text={
                  data.stalePriceCount > 0
                    ? `${data.stalePriceCount} 个价 90 天没核价了，还能用，但报价前扫一眼`
                    : '没有长期没核价的价'
                }
                action={{ label: '去核', href: '/materials' }}
                detail={
                  stale.length > 0
                    ? stale.map((s) => (
                        <div key={s.priceId} className="t-sm t-2">
                          {s.itemName} · {s.supplierName} · {formatStaleDays(s.stalenessDays)}
                        </div>
                      ))
                    : null
                }
              />

              {/* ④ 无报价主体：接口没给计数，就不编数字，只给入口 */}
              <Todo
                index="④"
                tone="neutral"
                text="还有物料没有任何供应商报价，比价时会是空的"
                action={{ label: '去补', href: '/materials' }}
              />
            </ul>
          </div>

          {/* 最近动作（仅管理员可见 · 只记录不阻断） */}
          <div className="section-title">
            最近动作（仅管理员可见 · 只记录不阻断）
          </div>
          {data.recentPriceChanges && data.recentPriceChanges.length > 0 ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">时间</th>
                    <th scope="col">类型</th>
                    <th scope="col">物料</th>
                    <th scope="col">供应商</th>
                    <th scope="col" className="ta-r">原价</th>
                    <th scope="col" className="ta-r">现价</th>
                    <th scope="col" className="ta-r">变化</th>
                    <th scope="col">谁</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPriceChanges.slice(0, 8).map((c) => {
                    const change =
                      c.oldPrice && c.newPrice && Number(c.oldPrice) !== 0
                        ? (Number(c.newPrice) - Number(c.oldPrice)) / Number(c.oldPrice)
                        : null;
                    return (
                      <tr key={`${c.priceId}-${c.changedAt}`}>
                        <td className="t-3">{formatTimeRel(c.changedAt)}</td>
                        <td>
                          {c.action === 'manual' ? (
                            '手填'
                          ) : c.isOverwrite ? (
                            <span title={c.isOverwrite ? '这条覆盖了已有价' : undefined}>改价 · 覆盖</span>
                          ) : c.action === 'created' ? (
                            '录价'
                          ) : (
                            '改价'
                          )}
                        </td>
                        <td className="truncate">{c.itemName}</td>
                        <td className="t-2 truncate">{c.supplierName}</td>
                        <td className="ta-r">
                          <Money value={c.oldPrice ?? null} size="sm" />
                        </td>
                        <td className="ta-r">
                          <Money value={c.newPrice ?? null} size="sm" />
                        </td>
                        <td className={cx('ta-r t-xs', change && change > 0 ? 't-danger' : change && change < 0 ? 't-success' : 't-3')}>
                          {change === null ? '—' : formatDelta(change)}
                        </td>
                        <td className="t-2">{c.changedByName ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Note>还没有人改过价。这一块只记录、不阻断、不排行。</Note>
          )}

          {/* 常用物料 chips：一次点击直接进新报价单 */}
          {data.favoriteItems && data.favoriteItems.length > 0 ? (
            <>
              <div className="section-title">常用物料</div>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                {data.favoriteItems.map((it) => (
                  <Link
                    key={it.id}
                    href={`/materials/${it.id}`}
                    className="chip"
                    style={{ height: 'auto', padding: 'var(--space-2) var(--space-3)', alignItems: 'center' }}
                  >
                    <span className="truncate max-w-[160px]">{it.name}</span>
                    <LowestSummaryView
                      summary={it.lowestSummary}
                      itemType={it.itemType}
                      unitName={it.baseUnitName}
                      maxRows={2}
                    />
                  </Link>
                ))}
              </div>
            </>
          ) : null}

          <div className="section-title">库里的总量</div>
          <div className="flex flex-wrap gap-[var(--space-7)] t-sm t-3">
            <span>物料 <b className="num t-2">{formatNumber(data.materialCount, 0)}</b> 个</span>
            <span>人员 <b className="num t-2">{formatNumber(data.personnelCount, 0)}</b> 位</span>
            <span>供应商 <b className="num t-2">{formatNumber(data.supplierCount, 0)}</b> 家</span>
            <span>价格 <b className="num t-2">{formatNumber(data.priceCount, 0)}</b> 条</span>
            <span>本月开出去 <b className="num t-2">{formatMoney(data.monthQuoteTotal, { symbol: true })}</b></span>
          </div>
        </>
      )}
    </div>
  );
}

function Todo({
  index,
  text,
  action,
  detail,
  tone,
  icon,
}: {
  index: string;
  text: string;
  action: { label: string; href: string };
  detail?: React.ReactNode;
  tone: 'neutral' | 'danger' | 'warn';
  icon?: React.ReactNode;
}) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : 'var(--fg-3)';
  return (
    <li
      style={{ borderBottom: '1px solid var(--border-soft)', padding: 'var(--space-4) var(--space-5)' }}
      className="flex items-start gap-[var(--space-4)]"
    >
      <span className="num t-sm" style={{ color, width: '16px', textAlign: 'left' }} aria-hidden="true">
        {index}
      </span>
      <div className="min-w-0" style={{ flex: 1 }}>
        <div className="flex items-center gap-[var(--space-3)]">
          {icon ? <span style={{ color }}>{icon}</span> : null}
          <span className="t-md" style={{ color: tone === 'neutral' ? 'var(--fg)' : color }}>
            {text}
          </span>
          {tone === 'danger' ? <Badge tone="danger">会拦住出单</Badge> : null}
        </div>
        {detail ? <div className="mt-[var(--space-2)] flex flex-col gap-[var(--space-1)]">{detail}</div> : null}
      </div>
      <Link href={action.href} className="btn btn--ghost btn--sm shrink-0">
        {action.label}
        <IconArrowRight size={16} />
      </Link>
    </li>
  );
}
