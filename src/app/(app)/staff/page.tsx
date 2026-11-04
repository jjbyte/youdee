'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { cx, formatMoney } from '@/lib/format';
import { unitModeLabel } from '@/lib/labels';
import type { Category, ItemListItem, LowestSummaryGroup } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/field';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { NewItemButton } from '@/components/new-item-button';
import { AddToQuoteModal } from '@/components/add-to-quote-modal';
import { Toast } from '@/components/ui/overlay';
import { IconSearch, IconStaff } from '@/components/icons';

const PAGE_SIZE = 20;
const MODE_ORDER = ['per_day', 'per_event', 'per_person_day', 'per_hour', 'per_half_day'];

function sortGroups(groups: LowestSummaryGroup[]): LowestSummaryGroup[] {
  return [...groups].sort((a, b) => {
    const ia = MODE_ORDER.indexOf(a.pricingMode ?? '');
    const ib = MODE_ORDER.indexOf(b.pricingMode ?? '');
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/**
 * 人员库（§C.5）。
 *
 * 关键一句：**计价方式列显示的是每一行自己的 `unit_mode`，不是这个人档案上的默认值。**
 * 一位按「人天」备案的讲师，A 经纪按场报 ¥2,800 —— 档案默认是按人天，但这条价实际按场。
 * 拿档案值去展示和分组，就会把 ¥2,800 归进「按人天」组和别人的 ¥1,500 一起标最低。
 *
 * 单价必须带计价单位：主持人的 ¥2,800 不带「/场」会被误读成"一次"还是"一天"，差一倍。
 */
export default function StaffPage() {
  const router = useRouter();
  /**
   * 侧边栏「嘉宾价」用 ?category=guest 进来；分类还没加载完时先占位，加载完按名字找「专业嘉宾」。
   * 用 window.location 而不是 useSearchParams：后者在构建期要求 Suspense 边界，
   * 否则整条路由退回纯客户端渲染——这是个只在 build 时才炸的坑。
   */
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ItemListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const p = await api.items({
        itemType: 'personnel',
        q: q.trim() || undefined,
        categoryId: categoryId || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(p.items ?? []);
      setTotal(p.total ?? 0);
      setStatus('ready');
    } catch (e) {
      setError(errorMessage(e));
      setStatus('error');
    }
  }, [q, categoryId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .categories('personnel')
      .then((c) => {
        const list = Array.isArray(c) ? c : (c.personnel ?? []);
        setCategories(list);
        // 在 effect 里就地读 URL，不经过 state：state 要等下一次渲染才生效，
        // 而这里只判断一次，读 state 会读到初值 false，嘉宾就永远选不中。
        const wantGuest = new URLSearchParams(window.location.search).get('category') === 'guest';
        if (wantGuest && !categoryId) {
          const g = list.find((x) => x.name.includes('嘉宾'));
          if (g) setCategoryId(g.id);
        }
      })
      .catch(() => setCategories([]));
    // 只在首次加载分类时决定一次，之后用户点什么就是什么
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">人员库</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            按「计价方式」管人，不按人管价。同一个人可以按场报过一次、按天报过两次——那是现实，不是数据缺失。
          </p>
        </div>
        <div className="flex items-center gap-[var(--space-3)]">
          <Link href="/vendors" className="btn btn--secondary btn--sm">
            看供应商
          </Link>
          <NewItemButton itemType="personnel" label="新建人员" />
        </div>
      </div>

      <div className="flex items-center gap-[var(--space-3)] flex-wrap mt-[var(--space-5)]">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="搜姓名 / 工种 / 手机号"
          ariaLabel="搜索人员"
          inputRef={searchRef}
          className="min-w-[280px]"
        />
      </div>

      <div className="flex items-center gap-[var(--space-2)] flex-wrap mt-[var(--space-4)]">
        <span className="t-xs t-3">分类</span>
        <button
          type="button"
          className={cx('chip', categoryId === '' && 'chip--on')}
          aria-pressed={categoryId === ''}
          onClick={() => {
            setCategoryId('');
            setPage(1);
          }}
        >
          全部 <span className="num">{total}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cx('chip', categoryId === c.id && 'chip--on')}
            aria-pressed={categoryId === c.id}
            onClick={() => {
              setCategoryId(c.id);
              setPage(1);
            }}
          >
            {c.name}
            {typeof c.itemCount === 'number' ? <span className="num">{c.itemCount}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-[var(--space-4)]">
        {status === 'loading' ? <TableSkeleton rows={8} cols={6} /> : null}
        {status === 'error' ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {status === 'ready' && rows.length === 0 ? (
          <EmptyState
            icon={<IconStaff size={24} />}
            title={q ? `没找到「${q}」。` : '人员库还是空的。'}
            body={
              q
                ? '换个说法试试——搜姓氏、工种都行。'
                : '先把常合作的主持人、摄影、礼仪录进来：一个人的几种计价方式各录一条价，比价时就不会把「按场」和「按天」混在一起。'
            }
            primary={{ label: '看物料库', href: '/materials' }}
          />
        ) : null}

        {status === 'ready' && rows.length > 0 ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th align="center" aria-label="全选" />
                    <Th>姓名</Th>
                    <Th>分类</Th>
                    <Th>计价方式</Th>
                    <Th align="right">单价</Th>
                    <Th align="right">报价数</Th>
                    <Th>来源</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => {
                    const groups = sortGroups(it.lowestSummary?.groups ?? []);
                    return (
                      <tr key={it.id} onClick={() => router.push(`/staff/${it.id}`)} style={{ cursor: 'pointer' }}>
                        <Td align="center">
                          <input
                            type="checkbox"
                            checked={selected.has(it.id)}
                            aria-label={`选择 ${it.name}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(it.id)) next.delete(it.id);
                                else next.add(it.id);
                                return next;
                              })
                            }
                          />
                        </Td>
                        <Td>
                          <div className="truncate">{it.name}</div>
                          <span className="cell-sub truncate">{it.spec ?? '—'}</span>
                        </Td>
                        <Td>
                          <span className="t-xs">{it.categoryName}</span>
                        </Td>
                        <Td>
                          {groups.length === 0 ? (
                            <span className="t-xs t-3">还没录价</span>
                          ) : (
                            <span className="lowest-lines">
                              {groups.map((g, i) => (
                                <span key={`${it.id}-m${i}`} className="t-xs">
                                  {unitModeLabel(g.pricingMode) || g.unitCode}
                                </span>
                              ))}
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          {groups.length === 0 ? (
                            <span className="num t-3">—</span>
                          ) : (
                            <span className="lowest-lines">
                              {groups.map((g, i) => (
                                <span key={`${it.id}-p${i}`} className="num t-xs">
                                  {formatMoney(g.groupLowest)}
                                  <span className="t-3">/{g.unitCode}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          <span className="num t-3">{it.priceSupplierCount}</span>
                        </Td>
                        <Td>
                          {groups.length === 0 ? (
                            <span className="t-xs t-3">—</span>
                          ) : (
                            <span className="lowest-lines">
                              {groups.map((g, i) => (
                                <span key={`${it.id}-s${i}`} className="t-xs">
                                  {g.supplierType === 'internal' ? (
                                    <Badge tone="internal">自有</Badge>
                                  ) : (
                                    g.supplierName || '外聘'
                                  )}
                                </span>
                              ))}
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          <Link
                            href={`/staff/${it.id}`}
                            className="btn btn--link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            比价
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

            <div className="tbl-foot">
              <span>
                共 <span className="num">{total}</span> 条
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

      {selected.size > 0 ? (
        <div className="note mt-[var(--space-4)]">
          <span className="inline-flex items-center gap-[var(--space-3)]">
            已选 <span className="num">{selected.size}</span> 项
            <Button size="sm" variant="primary" icon={<IconSearch size={16} />} onClick={() => setAddOpen(true)}>
              攒进报价单
            </Button>
            <button type="button" className="btn btn--link" onClick={() => setSelected(new Set())}>
              取消
            </button>
          </span>
        </div>
      ) : null}

      <AddToQuoteModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        items={rows.filter((r) => selected.has(r.id))}
        onDone={(message) => {
          setAddOpen(false);
          setSelected(new Set());
          setToast(message);
        }}
      />

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
