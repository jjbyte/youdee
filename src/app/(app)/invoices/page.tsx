'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, type InvoiceQuery } from '@/lib/api';
import type { InvoicePage } from '@/lib/types';
import { canDeleteRecord } from '@/domain/permissions';
import { useMe } from '@/lib/use-me';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/overlay';
import { IconDownload, IconInvoice, IconPencil } from '@/components/icons';
import {
  EMPTY_INVOICE_FILTERS,
  InvoiceFiltersBar,
  hasInvoiceFilter,
  type InvoiceFilters,
} from '@/components/invoices/invoice-filters';
import { InvoiceSummaryCards } from '@/components/invoices/invoice-summary-cards';
import { InvoiceTable } from '@/components/invoices/invoice-table';
import { InvoiceUploadButton } from '@/components/invoices/invoice-upload-button';
import { InvoiceDrawer } from '@/components/invoices/invoice-drawer';

const PAGE_SIZE = 20;
/** 服务端单包上限：500 份 / 2GB。张数能提前判，体积只能在服务端判 */
const ZIP_MAX_FILES = 500;

/**
 * 发票台账。
 *
 * 三条与"对账"直接相关的决定：
 *
 * 1. **统计条在列表上方常显**（不是收在折叠面板里）。这些数字就是财务拿去核的数，
 *    藏起来等于每次都要点一下才敢相信列表。
 * 2. **冲红包在合计里是负数，且「含冲红 N 张」常显**。红票会翻符号，
 *    不写这句，人看到合计变小会以为系统算错了，然后开始手工重算——那这张台账就白做了。
 * 3. **下载与"勾选"解耦**：勾了就只下勾的，没勾就下当前查询结果的**全部**
 *    （不是当前页）。分页只是加载方式，不该决定下载范围。
 */
export default function InvoicesPage() {
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_INVOICE_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvoicePage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  /**
   * 识别配好了没有——只用于空态那一句话往哪指。
   * `unknown`（在读 / 读失败）不说成"没配"，否则网络抖一下就会告诉用户去填密钥。
   */
  const [ocrState, setOcrState] = useState<'unknown' | 'ready' | 'blocked'>('unknown');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'warn' | 'danger' } | null>(null);

  const { user } = useMe();
  const isAdmin = user ? canDeleteRecord(user.role) : false;

  /** 查询条件只写一份：列表与 ZIP 必须同源，否则"筛出来的"和"下下来的"不是同一批 */
  const query = useMemo<InvoiceQuery>(() => {
    const q: InvoiceQuery = {
      invoiceNo: filters.invoiceNo.trim() || undefined,
      buyer: filters.buyer.trim() || undefined,
      seller: filters.seller.trim() || undefined,
      issuedFrom: filters.issuedFrom || undefined,
      issuedTo: filters.issuedTo || undefined,
      status: filters.status || undefined,
      hasContract: filters.contract === '' ? undefined : filters.contract === 'linked' ? 1 : 0,
    };
    if (filters.includeDeleted && isAdmin) q.includeDeleted = true;
    return q;
  }, [filters, isAdmin]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.invoices({ ...query, page, limit: PAGE_SIZE });
      setData(d);
      setState('ready');
    } catch (e) {
      setError(errorMessage(e));
      setState('error');
    }
  }, [query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 改条件就换了一批票：勾选必须清掉，否则会把上一批的 id 混进这次下载 */
  const patchFilters = (patch: Partial<InvoiceFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(new Set());
    setPage(1);
  };

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = hasInvoiceFilter(filters);
  /** 只有"确实查完、确实一条都没有"才藏统计卡；loading 时照旧渲染，否则首屏会先空一下再冒出来 */
  const showSummary = state !== 'ready' || total > 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const all = rows.length > 0 && rows.every((r) => prev.has(r.id));
      if (all) {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });

  /**
   * 批量下载。用地址导航（隐藏 `<a download>`），**不 fetch→blob**：blob 会把整包读进内存，2GB 直接崩标签页。
   * 张数先在本地拦一道：服务端超限回 41301 的 JSON，直接导航过去用户只会看到满屏 JSON。
   */
  function download() {
    const ids = [...selected];
    const useSelected = ids.length > 0;
    const count = useSelected ? ids.length : total;
    if (count === 0) {
      setToast({ text: '当前条件下没有可下载的发票。', tone: 'warn' });
      return;
    }
    if (count > ZIP_MAX_FILES) {
      setToast({
        text: `这次要下 ${count} 份，一次最多 ${ZIP_MAX_FILES} 份。先用开票日期把范围筛小一点，或者勾选要的那几张。`,
        tone: 'warn',
      });
      return;
    }
    /* 勾选时**只发 ids**，不叠加筛选条件。后端契约就是这么定的：传了 ids 就只按 id 打包，
       其余条件一律不看。叠加也没有意义——用户勾的就是他看得见的那几行。 */
    const url = api.invoiceZipUrl(useSelected ? { ids: ids.join(',') } : query);
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setToast({
      text: useSelected
        ? `开始下载勾选的 ${count} 份原件。浏览器会直接存盘，不经过页面内存。`
        : `开始下载 ${count} 张票的原件。这次是整包，缺文件的会在包尾「_缺失清单.txt」里列出来。`,
      tone: 'success',
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">发票台账</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            进项票都在这儿，按开票日期倒序排。上传即识别，认不出的可以手工录；
            票号重复的会自动跳过，不会重复入库。
          </p>
        </div>
        {/* 窄屏要能换行：不换行时这一组会把标题挤成一列竖排的四个字 */}
        <div className="flex items-center gap-[var(--space-3)] flex-wrap">
          <Button
            variant="secondary"
            icon={<IconPencil size={16} />}
            onClick={() => {
              setDrawerId(null);
              setDrawerOpen(true);
            }}
          >
            手工录入
          </Button>
          <InvoiceUploadButton onUploaded={() => void load()} onReadyChange={setOcrState} />
        </div>
      </div>

      <div className="mt-[var(--space-5)]">
        <InvoiceFiltersBar
          value={filters}
          onChange={patchFilters}
          onReset={() => {
            setFilters(EMPTY_INVOICE_FILTERS);
            setSelected(new Set());
            setPage(1);
          }}
          total={state === 'ready' ? total : null}
          isAdmin={isAdmin}
        />
      </div>

      {/*
        一条都没命中时统计卡与下载区**整块不渲染**（不是 hidden/opacity:0——那会留下空白和一排能 Tab 到的死控件）。
        0 条时那六个数全是 0、口径说明没有对象、下载按钮是灰的，三样正好把空态顶到第五个区块。
        筛选区保留，否则用户没法改条件退出来。
      */}
      {showSummary ? (
        <>
          <div className="mt-[var(--space-4)]">
            <InvoiceSummaryCards
              summary={data?.summary ?? null}
              loading={state === 'loading'}
              includeDeleted={filters.includeDeleted}
            />
          </div>

          <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)] flex-wrap">
            <Button
              variant="secondary"
              icon={<IconDownload size={16} />}
              disabled={state !== 'ready' || (selected.size === 0 && total === 0)}
              onClick={download}
            >
              {selected.size > 0 ? `下载勾选的 ${selected.size} 张` : `下载查询结果（${total} 张）`}
            </Button>
            {selected.size > 0 ? (
              <button type="button" className="btn btn--link t-xs" onClick={() => setSelected(new Set())}>
                取消勾选
              </button>
            ) : null}
            <span className="t-xs t-3">
              勾了就只下勾选的；没勾就下当前筛选结果的全部，不是这一页。
            </span>
          </div>
        </>
      ) : null}

      <div className="mt-[var(--space-3)]">
        {state === 'loading' && !data ? <TableSkeleton rows={8} cols={10} /> : null}
        {state === 'error' ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {state === 'ready' && rows.length === 0 ? (
          <EmptyState
            icon={<IconInvoice size={24} />}
            title={hasFilter ? '这个条件下没有发票。' : '还没有发票。'}
            body={
              hasFilter
                ? '放宽一点再试：号码是精确匹配（全电 20 位、纸质 8 位都要输全），公司名输两个字就够，日期可以先留空。'
                : ocrState === 'blocked'
                  ? /* 空态最怕指错方向：批量上传此时是置灰的（识别还没配），
                       照着文案去点右上角会点一个按不动的按钮。所以先把能用的那个说出来。 */
                    '识别还没配置，先点「手工录入」把票号记下来；或者到「设置 → 发票识别」填上腾讯云密钥，之后就能把 PDF / JPG / PNG 批量传上来直接入账。'
                  : '点右上角「批量上传发票」，把 PDF / JPG / PNG 一起选进来——识别完直接进台账，票号重复的会自动跳过。没有原件也可以点「手工录入」先记票号。'
            }
          />
        ) : null}

        {rows.length > 0 && (state === 'ready' || state === 'loading') ? (
          <>
            <InvoiceTable
              rows={rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onOpen={(r) => {
                setDrawerId(r.id);
                setDrawerOpen(true);
              }}
            />
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

      <InvoiceDrawer
        open={drawerOpen}
        invoiceId={drawerId}
        isAdmin={isAdmin}
        onClose={() => setDrawerOpen(false)}
        onChanged={(message) => {
          setToast({ text: message, tone: 'success' });
          void load();
        }}
      />

      <Toast message={toast?.text ?? null} tone={toast?.tone} onClose={() => setToast(null)} />
    </div>
  );
}
