'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage, isUnauthorized } from '@/lib/api';
import { formatTimeRel } from '@/lib/format';
import { natureLabel, unitLabel } from '@/lib/labels';
import type { CompareResult, ItemDetail, ItemType, TaxBasis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { Toast } from '@/components/ui/overlay';
import { PriceEntryDrawer } from '@/components/price-entry-drawer';
import { ItemEditDrawer } from '@/components/item-edit-drawer';
import { useMe } from '@/lib/use-me';
import { canManageCatalog } from '@/domain/permissions';
import { CompareWorkbench } from '@/components/compare/compare-workbench';
import { IconExternal, IconPaperclip, IconPencil, IconPlus, IconRuler } from '@/components/icons';

/**
 * 比价页（§C.4）—— 本产品唯一的差异化视觉锤。
 *
 * 目标：一屏内回答四个问题
 *   ① 这个交易性质下最便宜是哪家 ② 线下还是线上便宜 ③ 差多少 ④ 有没有不能直接比的东西
 *
 * 两个不能错的地方：
 *   · **口径（tax_basis）是请求参数，不是行属性**。切换器只由设置项默认值/用户点击驱动，
 *     绝不拿 rows[0].taxIncluded 回填——那第一次点击碰巧对，第二个供应商口径不同时就静默比错。
 *   · **数量档切换不发请求**。接口整组返回 tiers，本地命中（见 compare-local.ts）。
 */
export function SubjectComparePage({ kind }: { kind: ItemType }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const listHref = kind === 'personnel' ? '/staff' : '/materials';

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taxBasis, setTaxBasis] = useState<TaxBasis>('inclusive');
  const [taxReady, setTaxReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { user } = useMe();
  const canEdit = user ? canManageCatalog(user.role) : false;
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const itemRef = useRef<ItemDetail | null>(null);
  itemRef.current = item;

  // 口径默认值只来自设置项（TC-4.8），不来自任何一行价
  useEffect(() => {
    api
      .quoteSettings()
      .then((s) => setTaxBasis(s.taxStatementDefault ?? 'inclusive'))
      .catch(() => void 0)
      .finally(() => setTaxReady(true));
  }, []);

  const load = useCallback(
    async (basis: TaxBasis) => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        // qty 传 1 只是让服务端有个合法入参；命中价、最低价、是否可比**全部在前端按真实 qty 重算**
        const [detail, cmp] = await Promise.all([api.item(id), api.compare(id, { qty: 1, taxBasis: basis })]);
        setItem(detail);
        setCompare(cmp);
      } catch (e) {
        if (isUnauthorized(e)) {
          router.replace('/login');
          return;
        }
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [id, router],
  );

  useEffect(() => {
    if (!taxReady) return;
    void load(taxBasis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxReady, taxBasis, reloadKey, load]);

  if (loading && !item) {
    return (
      <div className="page">
        <InlineLoading label="正在读这个物料的报价…" />
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} retryLabel="重新读一次" />
      </div>
    );
  }

  if (!item) return null;

  const natures = Array.from(new Set((compare?.groups ?? []).map((g) => g.pricingNature)));
  const supplierCount = item.priceSummary?.supplierCount ?? item.priceSupplierCount ?? 0;

  return (
    <div className="page flex flex-col" style={{ minHeight: 'calc(100dvh - var(--topbar-h))' }}>
      <header className="cmp-head">
        <div className="min-w-0">
          <div className="flex items-baseline gap-[var(--space-3)] flex-wrap">
            <h1 className="cmp-title">{item.name}</h1>
            {item.spec ? <span className="t-sm t-3">{item.spec}</span> : null}
            {natures.length === 1 ? (
              <Badge tone="neutral">{natureLabel(natures[0]!)}</Badge>
            ) : null}
          </div>

          <div className="cmp-meta">
            <span>比价基准单位 {unitLabel(item.compareUnitCode ?? item.baseUnitCode, item.compareUnitName ?? item.baseUnitName)}</span>
            <span className="t-muted">·</span>
            <span>{item.categoryName}</span>
            <span className="t-muted">·</span>
            <span className="num">{supplierCount} 家供应商</span>
            <span className="t-muted">·</span>
            <span>最近更新 {formatTimeRel(item.priceSummary?.latestUpdatedAt ?? item.updatedAt)}</span>
            {item.links && item.links.length > 0 ? (
              <>
                <span className="t-muted">·</span>
                <a href={item.links[0]!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-[var(--space-1)]">
                  {item.links[0]!.label || '参考链接'}
                  <IconExternal size={16} />
                </a>
              </>
            ) : null}
            {item.images && item.images.length > 0 ? (
              <>
                <span className="t-muted">·</span>
                <span className="inline-flex items-center gap-[var(--space-1)]">
                  <IconPaperclip size={16} />
                  参考图 {item.images.length}
                </span>
              </>
            ) : null}
            {item.note ? (
              <>
                <span className="t-muted">·</span>
                <span className="truncate" title={item.note}>
                  {item.note}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-[var(--space-3)]">
          <Button
            variant="secondary"
            size="sm"
            icon={<IconPencil size={16} />}
            disabled={!canEdit}
            title={canEdit ? '编辑档案（名称、分类、单位、别名）' : '档案只有管理员能改'}
            onClick={() => setEditOpen(true)}
          >
            编辑
          </Button>
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setDrawerOpen(true)}>
            新增报价
          </Button>
        </div>
      </header>

      {error && item ? (
        <div className="mt-[var(--space-4)]">
          <Note tone="danger">
            {error}{' '}
            <button type="button" className="btn btn--link" onClick={() => setReloadKey((k) => k + 1)}>
              再读一次
            </button>
          </Note>
        </div>
      ) : null}

      {compare ? (
        <CompareWorkbench
          item={item}
          compare={compare}
          taxBasis={taxBasis}
          onTaxBasis={setTaxBasis}
          onOpenPriceDrawer={() => setDrawerOpen(true)}
          onToast={setToast}
        />
      ) : (
        <InlineLoading label="正在算这个物料各家的价…" />
      )}

      {kind === 'personnel' ? (
        <section className="mt-[var(--space-5)]">
          <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)]">
            <span className="t-sm fw-semi">档期（未来 30 天）</span>
            <span className="t-2xs t-3">· 已占用 / 可预约</span>
          </div>
          <div className="note">
            <span className="t-xs">
              档期还没接上排期数据源。现在的「占用」只能从已发出的报价单反查，接口还没有这个字段，
              所以这里先不画方块——画一个空日历比不画更容易让人以为「这个人 30 天全空」。
            </span>
          </div>
        </section>
      ) : null}

      {item.compareUnitCode === null && supplierCount > 0 ? (
        <Note tone="info" className="mt-[var(--space-4)]">
          <span className="inline-flex items-center gap-[var(--space-2)]">
            <IconRuler size={16} />
            这个主体没设比价基准单位，各家按自己的单位报价，跨单位不标最低。
          </span>
        </Note>
      ) : null}

      <PriceEntryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={{
          id: item.id,
          name: item.name,
          itemType: item.itemType,
          baseUnitCode: item.baseUnitCode,
          baseUnitName: item.baseUnitName,
          compareUnitCode: item.compareUnitCode,
          effectivePricingNature: natures.length === 1 ? natures[0]! : (item.itemType === 'personnel' ? 'service' : null),
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      <ItemEditDrawer
        open={editOpen}
        itemId={item.id}
        itemType={item.itemType}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => {
          setToast(`已保存「${next.name}」`);
          setReloadKey((k) => k + 1);
        }}
      />

      <Toast message={toast} onClose={() => setToast(null)} />

      <div className="t-2xs t-3 mt-[var(--space-4)]">
        需要改档案？
        {canEdit ? (
          <button type="button" className="btn btn--link" onClick={() => setEditOpen(true)}>
            在这儿直接改
          </button>
        ) : (
          <Link href={`${listHref}?q=${encodeURIComponent(item.name)}`} className="btn btn--link">
            找管理员改
          </Link>
        )}
      </div>
    </div>
  );
}
