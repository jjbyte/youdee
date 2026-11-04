'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage, isUnauthorized } from '@/lib/api';
import type { Category, ItemListItem, Supplier } from '@/lib/types';
import { formatNumber, cx } from '@/lib/format';
import { Button, IconButton } from '@/components/ui/button';
import { SearchInput, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, TableSkeleton, Note } from '@/components/ui/states';
import { Table, TableFoot, TableWrap, Td, Th } from '@/components/ui/table';
import { LowestSummaryView } from '@/components/lowest-summary';
import { AddToQuoteModal } from '@/components/add-to-quote-modal';
import { NewItemButton } from '@/components/new-item-button';
import { PriceEntryDrawer } from '@/components/price-entry-drawer';
import { IconMore, IconPencil, IconPlus, IconQuote } from '@/components/icons';

const PAGE_SIZE = 20;

export default function MaterialsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ItemListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [entryFor, setEntryFor] = useState<ItemListItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  // 筛选条件从 URL 读一次（可分享/收藏），之后写回 URL 由 syncUrl 负责
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const sp = new URLSearchParams(window.location.search);
    const qq = sp.get('q');
    const cc = sp.get('category');
    if (qq) setQ(qq);
    if (cc) setCategoryId(cc);
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (categoryId) sp.set('category', categoryId);
    const next = sp.toString();
    const url = next ? `/materials?${next}` : '/materials';
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [q, categoryId]);

  useEffect(() => {
    api
      .categories('material')
      .then((res) => setCategories(Array.isArray(res) ? res : (res.material ?? [])))
      .catch(() => setCategories([]));
    api
      .suppliers({ limit: 100 })
      .then((p) => setSuppliers(p.items ?? []))
      .catch(() => setSuppliers([]));
  }, []);

  const load = useCallback(
    async (targetPage = 1) => {
      setStatus('loading');
      try {
        const res = await api.items({
          itemType: 'material',
          q: q || undefined,
          categoryId: categoryId || undefined,
          supplierId: supplierId || undefined,
          page: targetPage,
          limit: PAGE_SIZE,
        });
        setRows(res.items ?? []);
        setTotal(res.total ?? 0);
        setStatus('ready');
      } catch (e) {
        if (isUnauthorized(e)) {
          router.replace('/login');
          return;
        }
        setError(errorMessage(e));
        setStatus('error');
      }
    },
    [q, categoryId, supplierId, router],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load(1);
      setPage(1);
    }, 260);
    return () => window.clearTimeout(t);
  }, [load]);

  // `/` 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectedItems = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(q || categoryId || supplierId);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">物料库</h1>
          <div className="page-sub">
            找到物料 → 看谁最便宜、准不准 → 点进去比价。共 {formatNumber(total, 0)} 条。
          </div>
        </div>
        <NewItemButton itemType="material" label="新建物料" />
      </div>

      <div className="toolbar">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="搜物料名称 / 规格 / 别名    /"
          ariaLabel="搜物料"
          inputRef={searchRef}
          className="w-[320px]"
        />
        <Select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="按分类筛选"
          style={{ width: '160px' }}
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-label="按供应商筛选"
          style={{ width: '180px' }}
        >
          <option value="">全部供应商</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {hasFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setCategoryId('');
              setSupplierId('');
            }}
          >
            清掉筛选
          </Button>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-[var(--space-2)] mb-[var(--space-4)]">
          <button
            type="button"
            className={cx('chip', !categoryId && '!border-[var(--accent-border)]')}
            onClick={() => setCategoryId('')}
          >
            全部
            <span className="num t-3">{formatNumber(total, 0)}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx('chip', categoryId === c.id && '!border-[var(--accent-border)]')}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
              {typeof c.itemCount === 'number' ? <span className="num t-3">{c.itemCount}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <ErrorState message={error || '物料没加载出来。'} onRetry={() => void load(page)} />
      ) : status === 'loading' ? (
        <div className="tbl-wrap">
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : rows.length === 0 ? (
        hasFilter ? (
          <EmptyState
            title={`没找到「${q || '这个筛选'}」。换个说法试试，或者直接新建。`}
            primary={{ label: '清掉筛选', onClick: () => { setQ(''); setCategoryId(''); setSupplierId(''); } }}
            secondary={{ label: '去人员库看看', href: '/staff' }}
          />
        ) : (
          <>
            <EmptyState
              title="还没有录过物料价。先录一条试试：选个供应商，填个单价，写个生效日期就够了。"
              body="一个物料建好之后，第二个供应商的价录进来，比价才有意义。"
            />
            <div className="flex gap-[var(--space-3)] mt-[var(--space-4)]">
              <NewItemButton itemType="material" label="先建个物料" />
              <Button variant="secondary" onClick={() => router.push('/staff')}>
                先看看人员库
              </Button>
            </div>
          </>
        )
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th align="center" style={{ width: '36px' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      aria-label="全选本页"
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (allChecked) rows.forEach((r) => next.delete(r.id));
                          else rows.forEach((r) => next.add(r.id));
                          return next;
                        })
                      }
                    />
                  </Th>
                  <Th sticky>物料</Th>
                  <Th>单位</Th>
                  <Th align="right">最低价</Th>
                  <Th>供应商</Th>
                  <Th>报价数</Th>
                  <Th align="center">操作</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const multi = r.lowestSummary?.isMultiGroup;
                  const firstGroup = r.lowestSummary?.groups?.[0];
                  const isSelected = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      data-selected={isSelected}
                      className={cx(multi && 'tbl-row-2line')}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/materials/${r.id}`)}
                    >
                      <Td align="center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={`选中 ${r.name}`}
                          onChange={() => toggle(r.id)}
                        />
                      </Td>
                      <Td sticky>
                        <Link href={`/materials/${r.id}`} className="t-sm" style={{ color: 'var(--fg)' }}>
                          {r.name}
                        </Link>
                        {r.spec ? <span className="cell-sub">{r.spec}</span> : null}
                      </Td>
                      <Td className="t-3">{r.baseUnitName}</Td>
                      <Td align="right">
                        <LowestSummaryView
                          summary={r.lowestSummary}
                          itemType={r.itemType}
                          unitName={r.baseUnitName}
                          maxRows={2}
                        />
                      </Td>
                      <Td className="t-2">
                        {firstGroup?.supplierName ?? '—'}
                        {multi && firstGroup?.supplierName ? (
                          <span className="cell-sub">最低那一行是这家</span>
                        ) : null}
                      </Td>
                      <Td className="t-3">
                        {r.priceSupplierCount > 0 ? `${r.priceSupplierCount} 家` : '0 家'}
                      </Td>
                      <Td align="center" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <IconButton label={`给 ${r.name} 新增报价`} onClick={() => setEntryFor(r)}>
                            <IconPlus size={16} />
                          </IconButton>
                          <IconButton label={`编辑 ${r.name}`} onClick={() => router.push(`/materials/${r.id}`)}>
                            <IconPencil size={16} />
                          </IconButton>
                          <IconButton label={`更多操作 ${r.name}`}>
                            <IconMore size={16} />
                          </IconButton>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <TableFoot
              left={<span>共 {formatNumber(total, 0)} 条</span>}
              right={
                <span className="flex items-center gap-[var(--space-3)]">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      const p = page - 1;
                      setPage(p);
                      void load(p);
                    }}
                  >
                    上一页
                  </Button>
                  <span className="num">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => {
                      const p = page + 1;
                      setPage(p);
                      void load(p);
                    }}
                  >
                    下一页
                  </Button>
                </span>
              }
            />
          </TableWrap>

          {selected.size > 0 ? (
            <div
              className="panel flex items-center gap-[var(--space-4)]"
              style={{ position: 'sticky', bottom: 'var(--space-5)', marginTop: 'var(--space-4)', boxShadow: 'var(--shadow-2)' }}
            >
              <Badge>已选 {selected.size} 项</Badge>
              <Button variant="primary" icon={<IconQuote size={16} />} onClick={() => setAddOpen(true)}>
                攒进报价单
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Note className="mt-[var(--space-5)]">
        列表里的「最低价」只是同一交易性质内的最低。一个物料有买断价和租赁价时，这里会分行显示，别照着最低那一行报另一种性质的活。
      </Note>

      <AddToQuoteModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        items={selectedItems}
        onDone={(m) => {
          setToast(m);
          setSelected(new Set());
        }}
      />

      {entryFor ? (
        <PriceEntryDrawer
          open={Boolean(entryFor)}
          onClose={() => setEntryFor(null)}
          item={{
            id: entryFor.id,
            name: entryFor.name,
            itemType: entryFor.itemType,
            baseUnitCode: entryFor.baseUnitCode,
            baseUnitName: entryFor.baseUnitName,
            compareUnitCode: null,
          }}
          onSaved={() => void load(page)}
        />
      ) : null}

      {toast ? (
        <div className="fixed right-[var(--space-7)] bottom-[var(--space-8)] z-[var(--z-toast)] panel">
          <div className="flex items-center gap-[var(--space-3)]">
            <span className="t-sm">{toast}</span>
            <Button variant="ghost" size="sm" onClick={() => setToast(null)}>
              知道了
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="badge badge--md badge--neutral">{children}</span>;
}
