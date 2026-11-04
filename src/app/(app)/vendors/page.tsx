'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cx, formatStaleDays, formatTimeRel, todayISO } from '@/lib/format';
import { SUPPLIER_TYPE_LABELS, SUPPLIER_TYPE_ORDER, supplierTypeLabel } from '@/lib/labels';
import type { Price, Supplier, SupplierType } from '@/lib/types';
import { useMe } from '@/lib/use-me';
import { canManageCatalog } from '@/domain/permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/field';
import { Toast } from '@/components/ui/overlay';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { IconPlus, IconRisk, IconSupplierFactory } from '@/components/icons';
import { VendorDetailDrawer } from '@/components/vendors/vendor-detail-drawer';
import { NewVendorModal } from '@/components/vendors/new-vendor-modal';
import { VendorDeleteModal } from '@/components/vendors/vendor-delete-modal';

const PAGE_SIZE = 20;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * 供应商（§C.6）。
 *
 * 类型是**固定 5 值**，界面上永远显示中文，枚举码只出现在接口与筛选参数里。
 * `freelancer` 的话术按对象变：物料侧「经纪公司」、人员侧「个人 / 经纪」——
 * 因为「人挂在经纪公司」和「自己接单」对报价员的意义一样，都是一个外部供给源。
 *
 * 详情用抽屉而不是整页：信息量不足以撑满一页，且常从比价区就地查看。
 */
export default function VendorsPage() {
  const { user } = useMe();
  const isAdmin = user ? canManageCatalog(user.role) : false;

  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | SupplierType>('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [detailPrices, setDetailPrices] = useState<Price[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [toast, setToast] = useState<string | null>(null);


  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [list, ...rest] = await Promise.all([
        api.suppliers({ q: q.trim() || undefined, type: type || undefined, isActive: true, page, limit: PAGE_SIZE }),
        ...SUPPLIER_TYPE_ORDER.map((t) =>
          api.suppliers({ type: t, isActive: true, limit: 1 }).catch(() => null),
        ),
      ]);
      setRows(list.items ?? []);
      setTotal(list.total ?? 0);
      const next: Record<string, number> = {};
      SUPPLIER_TYPE_ORDER.forEach((t, i) => {
        const p = rest[i] as { total?: number } | null;
        next[t] = p?.total ?? 0;
      });
      setCounts(next);
      setStatus('ready');
    } catch (e) {
      setError(errorMessage(e));
      setStatus('error');
    }
  }, [q, type, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (s: Supplier) => {
    setDetail(s);
    setDetailPrices([]);
    setDetailLoading(true);
    try {
      const [d, p] = await Promise.all([
        api.supplier(s.id).catch(() => s),
        api.prices({ supplierId: s.id, limit: 50 }).catch(() => null),
      ]);
      setDetail(d);
      setDetailPrices(p?.items ?? []);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">供应商</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            物料和人员共用同一张供应商表。一个人挂在经纪公司就是一条「经纪公司」，是自有员工就是「自有」——
            所以「外聘 vs 自有」的成本对比，天然就是同一个人主体下两条价并列。
          </p>
        </div>
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          新建供应商
        </Button>
      </div>

      <div className="flex items-center gap-[var(--space-3)] flex-wrap mt-[var(--space-5)]">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="搜供应商名称 / 联系人 / 手机号"
          ariaLabel="搜索供应商"
          className="min-w-[280px]"
        />
      </div>

      <div className="flex items-center gap-[var(--space-2)] flex-wrap mt-[var(--space-4)]">
        <span className="t-xs t-3">类型</span>
        <button
          type="button"
          className={cx('chip', type === '' && 'chip--on')}
          aria-pressed={type === ''}
          onClick={() => {
            setType('');
            setPage(1);
          }}
        >
          全部 <span className="num">{total}</span>
        </button>
        {SUPPLIER_TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className={cx('chip', type === t && 'chip--on')}
            aria-pressed={type === t}
            onClick={() => {
              setType(t);
              setPage(1);
            }}
          >
            {SUPPLIER_TYPE_LABELS[t]}
            {counts[t] ? <span className="num">{counts[t]}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-[var(--space-4)]">
        {status === 'loading' ? <TableSkeleton rows={8} cols={5} /> : null}
        {status === 'error' ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {status === 'ready' && rows.length === 0 ? (
          <EmptyState
            icon={<IconSupplierFactory size={24} />}
            title={q || type ? '没有符合条件的供应商。' : '还没有供应商。'}
            body={
              q || type
                ? '换个关键词，或者把类型筛选清掉。'
                : '录价的时候可以直接新建供应商，不用先来这里登记。'
            }
            primary={{ label: '新建供应商', onClick: () => setCreating(true) }}
          />
        ) : null}

        {status === 'ready' && rows.length > 0 ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>供应商</Th>
                    <Th>类型</Th>
                    <Th>联系人</Th>
                    <Th align="right">报价数</Th>
                    <Th align="right">交期</Th>
                    <Th>最后更新</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const days = daysSince(s.updatedAt);
                    const stale = days !== null && days > 90;
                    return (
                      <tr key={s.id} onClick={() => void openDetail(s)} style={{ cursor: 'pointer' }}>
                        <Td>
                          <div className="truncate">{s.name}</div>
                          <span className="cell-sub truncate">{s.region || s.note || '—'}</span>
                        </Td>
                        <Td>
                          <Badge tone={s.type === 'internal' ? 'internal' : 'neutral'}>
                            {supplierTypeLabel(s.type)}
                          </Badge>
                        </Td>
                        <Td>
                          <span className="t-xs">{s.contactName || '—'}</span>
                          {s.contactPhone ? <span className="cell-sub num">{s.contactPhone}</span> : null}
                        </Td>
                        <Td align="right">
                          <span className="num">{s.priceCount ?? 0}</span>
                        </Td>
                        <Td align="right">
                          <span className="num t-3">
                            {s.defaultLeadTimeDays ? `${s.defaultLeadTimeDays} 天` : '—'}
                          </span>
                        </Td>
                        <Td>
                          <span className={cx('t-xs', stale ? 't-warning' : 't-3')}>
                            {stale ? (
                              <span className="inline-flex items-center gap-[var(--space-1)]">
                                <IconRisk size={16} />
                                {formatStaleDays(days)}
                              </span>
                            ) : (
                              formatTimeRel(s.updatedAt)
                            )}
                          </span>
                        </Td>
                        <Td align="right">
                          <button
                            type="button"
                            className="btn btn--link"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openDetail(s);
                            }}
                          >
                            看报价
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

            <div className="tbl-foot">
              <span>
                共 <span className="num">{total}</span> 家
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

      <VendorDetailDrawer
        detail={detail}
        prices={detailPrices}
        loading={detailLoading}
        isAdmin={isAdmin}
        onClose={() => setDetail(null)}
        onDelete={(v) => setConfirmDelete(v)}
      />

      <NewVendorModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (name) => {
          setCreating(false);
          setToast(`建好了：${name}`);
          await load();
        }}
      />

      <VendorDeleteModal
        supplier={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onDeleted={async (message) => {
          setConfirmDelete(null);
          setDetail(null);
          setToast(message);
          await load();
        }}
        onError={(message) => {
          setConfirmDelete(null);
          setToast(message);
        }}
      />

      <Toast message={toast} onClose={() => setToast(null)} />

      <div className="t-2xs t-3 mt-[var(--space-4)]">
        今天是 {todayISO()}。最后更新超过 90 天的会标成琥珀——不是它错了，是可能不准了。
      </div>
    </div>
  );
}
