'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { cx, formatMoney } from '@/lib/format';
import { unitLabel, unitModeLabel } from '@/lib/labels';
import type { Category, ItemListItem, LowestSummaryGroup } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/field';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { NewItemButton } from '@/components/new-item-button';
import { ItemEditDrawer } from '@/components/item-edit-drawer';
import { useMe } from '@/lib/use-me';
import { canDeleteRecord, canManageCatalog } from '@/domain/permissions';
import { IconPencil } from '@/components/icons';
import { AddToQuoteModal } from '@/components/add-to-quote-modal';
import { Toast } from '@/components/ui/overlay';
import { ConfirmModal, type ConfirmSpec } from '@/components/ui/confirm-modal';
import { IconArchive, IconRestore, IconSearch, IconStaff, IconTrash } from '@/components/icons';

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
 *
 * 两种进入方式，同一个组件：
 *   · `/staff`                     —— 全部人员，分类由用户点。
 *   · `/guests`（guest=true）       —— 预置筛选视图，进来就锁在「专业嘉宾」。
 *   · `/staff?category=guest`      —— 0.1.8 及以前的老链接，仍然认（归位到 /guests）。
 *
 * 0.1.11 起侧栏不再挂「嘉宾价」入口：人员库本身就能按分类筛，两个入口并存只会让人
 * 以为这是两个模块。路由保留——老书签、别人发来的地址打开还是这个预置视图。
 *
 * 为什么它当初要有独立路由，而不是只加个 query：**同一个 pathname 换 query 不会重挂载**，
 * 组件状态原样保留，于是 URL 变了、列表却不变——点了像没反应。
 */
export function StaffLibrary({ guest = false }: { guest?: boolean }) {
  const router = useRouter();
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
  const [editId, setEditId] = useState<string | null>(null);
  const { user } = useMe();
  const isAdmin = user ? canManageCatalog(user.role) : false;
  const canDelete = user ? canDeleteRecord(user.role) : false;
  /** 含已作废：不过滤 is_active 才看得见作废的人，恢复功能才有入口 */
  const [showArchived, setShowArchived] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const p = await api.items({
        itemType: 'personnel',
        q: q.trim() || undefined,
        categoryId: categoryId || undefined,
        isActive: showArchived ? 'all' : true,
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
  }, [q, categoryId, page, showArchived]);

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
        // 用 window.location 而不是 useSearchParams：后者在构建期要求 Suspense 边界，
        // 否则整条路由退回纯客户端渲染——这是个只在 build 时才炸的坑。
        const wantGuest = new URLSearchParams(window.location.search).get('category') === 'guest';
        if (!guest && wantGuest) {
          // 0.1.8 及以前的老链接（书签、别人发来的地址）归位到 /guests：
          // 否则地址栏写着「人员库」、侧栏也高亮「人员库」，内容却是嘉宾价。
          router.replace('/guests');
          return;
        }
        if (guest) {
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

  const askArchive = (it: ItemListItem) =>
    setConfirm({
      title: `作废「${it.name}」？`,
      body: '作废后不再出现在人员库、嘉宾价和选品栏里，历史报价单不受影响。',
      warn: '作废随时能恢复——打开「含已作废」就能把他找回来。',
      confirmLabel: '作废',
      run: async () => {
        await api.archiveItem(it.id);
        setConfirm(null);
        setToast(`「${it.name}」已作废。要恢复就打开「含已作废」再点恢复。`);
        void load();
      },
    });

  const askRestore = (it: ItemListItem) =>
    setConfirm({
      title: `恢复「${it.name}」？`,
      body: '恢复后重新出现在人员库里，他的价也都还在。',
      confirmLabel: '恢复',
      tone: 'primary',
      run: async () => {
        await api.restoreItem(it.id);
        setConfirm(null);
        setToast(`「${it.name}」已恢复。`);
        void load();
      },
    });

  const askDelete = (it: ItemListItem) =>
    setConfirm({
      title: `删掉「${it.name}」？`,
      body: '删掉后这个人从库里消失，不会再回来。',
      warn:
        it.priceSupplierCount > 0
          ? `他有 ${it.priceSupplierCount} 家的报价，会一起删掉。已经发出的报价单里的数字不变。如果只是暂时不用，用「作废」更好。`
          : '删除不可恢复。如果只是暂时不用，用「作废」更合适。',
      confirmLabel: '确认删掉',
      run: async () => {
        const res = await api.deleteItem(it.id);
        setConfirm(null);
        setToast(
          res.priceCount > 0 ? `「${res.name}」已删除，连带删掉 ${res.priceCount} 条报价。` : `「${res.name}」已删除。`,
        );
        void load();
      },
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">{guest ? '嘉宾价' : '人员库'}</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            {guest
              ? '讲师、专家、KOL、圆桌嘉宾都在这一类：他们按天或半天算钱，和演艺「按场」是两套口径，所以单独留这个预置视图——找讲师和找舞蹈演员，本来就是两个采购渠道。'
              : '按「计价方式」管人，不按人管价。同一个人可以按场报过一次、按天报过两次——那是现实，不是数据缺失。'}
          </p>
        </div>
        <div className="flex items-center gap-[var(--space-3)]">
          {guest ? (
            <Link href="/staff" className="btn btn--secondary btn--sm">
              看全部人员
            </Link>
          ) : (
            <Link href="/vendors" className="btn btn--secondary btn--sm">
              看供应商
            </Link>
          )}
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
        <label className="inline-flex items-center gap-[var(--space-2)] t-xs t-3 ml-auto">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          含已作废
        </label>
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
            title={q ? `没找到「${q}」。` : guest ? '「专业嘉宾」这一类还是空的。' : '人员库还是空的。'}
            body={
              q
                ? '换个说法试试——搜姓氏、工种都行。'
                : guest
                  ? '讲师、专家、KOL 都录进「专业嘉宾」这个分类；录一条价，这里就能比了。'
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
                          <span className="cell-sub truncate">
                            {!it.isActive ? <span className="badge badge--sm badge--neutral mr-[var(--space-2)]">已作废</span> : null}
                            {it.spec ?? '—'}
                          </span>
                        </Td>                        <Td>
                          <span className="t-xs">{it.categoryName}</span>
                        </Td>
                        <Td>
                          {groups.length === 0 ? (
                            <span className="t-xs t-3">还没录价</span>
                          ) : (
                            <span className="lowest-lines">
                              {groups.map((g, i) => (
                                <span key={`${it.id}-m${i}`} className="t-xs">
                                  {unitModeLabel(g.pricingMode) || unitLabel(g.unitCode)}
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
                                  <span className="t-3">/{unitLabel(g.unitCode)}</span>
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
                          <div className="flex items-center justify-end gap-[var(--space-3)]">
                            {isAdmin ? (
                              <button
                                type="button"
                                className="btn btn--link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditId(it.id);
                                }}
                              >
                                <IconPencil size={14} />
                                编辑
                              </button>
                            ) : null}
                            <Link
                              href={`/staff/${it.id}`}
                              className="btn btn--link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              比价
                            </Link>
                            {it.isActive ? (
                              <button
                                type="button"
                                className="btn btn--link"
                                title="作废后不再出现，随时能恢复"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  askArchive(it);
                                }}
                              >
                                作废
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  askRestore(it);
                                }}
                              >
                                <IconRestore size={14} />
                                恢复
                              </button>
                            )}
                            {canDelete ? (
                              <button
                                type="button"
                                className="btn btn--link t-danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  askDelete(it);
                                }}
                              >
                                <IconTrash size={14} />
                              </button>
                            ) : null}
                          </div>
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

      <ItemEditDrawer
        open={Boolean(editId)}
        itemId={editId}
        itemType="personnel"
        onClose={() => setEditId(null)}
        onSaved={(it) => {
          setToast(`已保存「${it.name}」`);
          void load();
        }}
      />

      <Toast message={toast} onClose={() => setToast(null)} />
      <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
