'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cx, formatDate, formatMoney, formatTimeRel } from '@/lib/format';
import type { Contract, ContractCategory, Page } from '@/lib/types';
import { CONTRACT_CATEGORIES, contractCategoryLabel } from '@/domain/contract';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, SearchInput, Select } from '@/components/ui/field';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ConfirmModal, type ConfirmSpec } from '@/components/ui/confirm-modal';
import { Toast } from '@/components/ui/overlay';
import { useMe } from '@/lib/use-me';
import { canDeleteRecord } from '@/domain/permissions';
import { IconContract, IconPaperclip, IconPlus } from '@/components/icons';
import { ContractDrawer } from '@/components/contracts/contract-drawer';

const PAGE_SIZE = 20;

type FileFilter = '' | 'has' | 'missing';

/**
 * 合同管理。
 *
 * 查询维度照客户在 Excel 里每天翻的那几列来：**合同编号、合同名称、
 * 公司名称（甲方）、客户名称（乙方）、签订日期区间、创建日期区间**。
 * 顶部搜索框是兜底（六个字段一起模糊）——人记不住自己想查的是哪一列，
 * 输了就出结果比先让他选对字段更重要。
 *
 * 已删除只有管理员看得到，且删除是软删：附件常常是唯一副本，
 * 真删掉等于把凭据从台账里抹了。
 */
export default function ContractsPage() {
  const [q, setQ] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [customer, setCustomer] = useState('');
  const [category, setCategory] = useState<'' | ContractCategory>('');
  const [signedFrom, setSignedFrom] = useState('');
  const [signedTo, setSignedTo] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [fileFilter, setFileFilter] = useState<FileFilter>('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Contract> | null>(null);
  /** 每个分类各有多少份（跟随除分类外的其它条件），画在分类徽标后面 */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { user } = useMe();
  const isAdmin = user ? canDeleteRecord(user.role) : false;

  const load = useCallback(async () => {
    setState('loading');
    try {
      // 查询条件只写一份：列表与分类徽标上的数字必须严格同源，
      // 否则"商业合同 3"点进去只有 2 条，这种对不上的数字比不显示还糟。
      const query = {
        q: q.trim() || undefined,
        contractNo: contractNo.trim() || undefined,
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        customer: customer.trim() || undefined,
        signedFrom: signedFrom || undefined,
        signedTo: signedTo || undefined,
        createdFrom: createdFrom || undefined,
        createdTo: createdTo || undefined,
        hasFile: fileFilter === '' ? undefined : fileFilter === 'has',
        includeDeleted: includeDeleted && isAdmin ? true : undefined,
      };
      const [list, ...rest] = await Promise.all([
        api.contracts({ ...query, category: category || undefined, page, limit: PAGE_SIZE }),
        // 每个分类各探一次（limit=1 只为了拿 total）——与供应商页"类型"徽标同一种做法
        ...CONTRACT_CATEGORIES.map((c) =>
          api.contracts({ ...query, category: c.value, page: 1, limit: 1 }).catch(() => null),
        ),
      ]);
      setData(list);
      const next: Record<string, number> = {};
      CONTRACT_CATEGORIES.forEach((c, i) => {
        next[c.value] = (rest[i] as Page<Contract> | null)?.total ?? 0;
      });
      setCounts(next);
      setState('ready');
    } catch (e) {
      setError(errorMessage(e));
      setState('error');
    }
  }, [
    q,
    contractNo,
    title,
    company,
    customer,
    category,
    signedFrom,
    signedTo,
    createdFrom,
    createdTo,
    fileFilter,
    includeDeleted,
    isAdmin,
    page,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // `/` 聚焦搜索框，与报价单列表一致
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
  // 「全部」上的数字：选中某个分类后列表 total 只剩那一类，所以按三类求和还原总量
  const allCount = category ? CONTRACT_CATEGORIES.reduce((s, c) => s + (counts[c.value] ?? 0), 0) : total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(
    q.trim()
      || contractNo.trim()
      || title.trim()
      || company.trim()
      || customer.trim()
      || category
      || signedFrom
      || signedTo
      || createdFrom
      || createdTo
      || fileFilter
      || includeDeleted,
  );

  const resetFilters = () => {
    setQ('');
    setContractNo('');
    setTitle('');
    setCompany('');
    setCustomer('');
    setCategory('');
    setSignedFrom('');
    setSignedTo('');
    setCreatedFrom('');
    setCreatedTo('');
    setFileFilter('');
    setPage(1);
  };

  const afterChange = async (message: string) => {
    setConfirm(null);
    setToast(message);
    await load();
  };

  const askDelete = (r: Contract) =>
    setConfirm({
      title: `删除「${r.title}」？`,
      body: (
        <>
          删掉后这份合同从列表里消失，管理员可以在「已删除」里恢复。
          {r.fileCount > 0 ? `它的 ${r.fileCount} 份附件会一起藏起来，但文件没有被删。` : ''}
        </>
      ),
      warn: '合同是凭据。删了之后新来的同事就再也查不到这份合同了——只是不想看它的话，先想一下为什么。',
      confirmLabel: '删除',
      run: async () => {
        await api.deleteContract(r.id);
        await afterChange(`「${r.title}」已删除。要反悔就在「已删除」里恢复。`);
      },
    });

  const askRestore = (r: Contract) =>
    setConfirm({
      title: `恢复「${r.title}」？`,
      body: '恢复后回到默认列表，合同、报价单与结算附件原样还在。',
      confirmLabel: '恢复',
      tone: 'primary',
      run: async () => {
        await api.restoreContract(r.id);
        await afterChange(`「${r.title}」已恢复。`);
      },
    });

  /** 小筛选项：标签在上、控件在下，与全站列表一致 */
  const label = (text: string, node: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-[var(--space-1)]">
      <span className="t-2xs t-3">{text}</span>
      {node}
      {hint ? <span className="t-2xs t-3">{hint}</span> : null}
    </label>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">合同管理</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            公司签过的合同都在这儿。合同电子版、报价单、结算资料都跟着合同存，按编号、名称、甲乙方、日期都能查到。
          </p>
        </div>
        <Button
          variant="primary"
          icon={<IconPlus size={16} />}
          onClick={() => {
            setDrawerId(null);
            setDrawerOpen(true);
          }}
        >
          新建合同
        </Button>
      </div>

      <div className="mt-[var(--space-5)] flex flex-col gap-[var(--space-3)]">
        {/* 第一行：按字段精确查。左侧搜索框是兜底入口 */}
        <div className="flex items-end gap-[var(--space-3)] flex-wrap">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="什么都搜：编号 / 名称 / 甲方 / 乙方 / 项目"
            ariaLabel="搜索合同"
            inputRef={searchRef}
            className="min-w-[240px]"
          />
          {label(
            '合同编号',
            <Input
              value={contractNo}
              placeholder="HT-2026-018"
              aria-label="按合同编号查询"
              style={{ width: 150 }}
              onChange={(e) => {
                setContractNo(e.target.value);
                setPage(1);
              }}
            />,
          )}
          {label(
            '合同名称',
            <Input
              value={title}
              placeholder="活动执行合同"
              aria-label="按合同名称查询"
              style={{ width: 170 }}
              onChange={(e) => {
                setTitle(e.target.value);
                setPage(1);
              }}
            />,
          )}
          {label(
            '公司名称（甲方）',
            <Input
              value={company}
              placeholder="星野科技"
              aria-label="按公司名称（甲方）查询"
              style={{ width: 150 }}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
            />,
          )}
          {label(
            '客户名称（乙方）',
            <Input
              value={customer}
              placeholder="云图文化"
              aria-label="按客户名称（乙方）查询"
              style={{ width: 150 }}
              onChange={(e) => {
                setCustomer(e.target.value);
                setPage(1);
              }}
            />,
          )}
        </div>

        {/* 第二行：两个日期区间 + 资料齐全度 + 删除状态（分类挪到表格上方做快速筛选） */}
        <div className="flex items-end gap-[var(--space-3)] flex-wrap">
          {label(
            '签订日期',
            <span className="flex items-center gap-[var(--space-2)]">
              <Input
                type="date"
                value={signedFrom}
                aria-label="签订日期起"
                style={{ width: 146 }}
                onChange={(e) => {
                  setSignedFrom(e.target.value);
                  setPage(1);
                }}
              />
              <span className="t-3">~</span>
              <Input
                type="date"
                value={signedTo}
                aria-label="签订日期止"
                style={{ width: 146 }}
                onChange={(e) => {
                  setSignedTo(e.target.value);
                  setPage(1);
                }}
              />
            </span>,
          )}
          {label(
            '创建日期',
            <span className="flex items-center gap-[var(--space-2)]">
              <Input
                type="date"
                value={createdFrom}
                aria-label="创建日期起"
                style={{ width: 146 }}
                onChange={(e) => {
                  setCreatedFrom(e.target.value);
                  setPage(1);
                }}
              />
              <span className="t-3">~</span>
              <Input
                type="date"
                value={createdTo}
                aria-label="创建日期止"
                style={{ width: 146 }}
                onChange={(e) => {
                  setCreatedTo(e.target.value);
                  setPage(1);
                }}
              />
            </span>,
          )}
          {label(
            '附件',
            <Select
              value={fileFilter}
              aria-label="附件筛选"
              style={{ width: 120 }}
              onChange={(e) => {
                setFileFilter(e.target.value as FileFilter);
                setPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="has">已上传</option>
              <option value="missing">还没传</option>
            </Select>,
          )}
          {isAdmin
            ? label(
                '删除状态',
                <Select
                  value={includeDeleted ? 'deleted' : 'live'}
                  aria-label="删除状态筛选"
                  style={{ width: 110 }}
                  onChange={(e) => {
                    setIncludeDeleted(e.target.value === 'deleted');
                    setPage(1);
                  }}
                >
                  <option value="live">在用</option>
                  <option value="deleted">已删除</option>
                </Select>,
              )
            : null}
          <span className="ml-auto flex items-center gap-[var(--space-3)]">
            <span className="t-xs t-3">
              共 <span className="num">{total}</span> 份
              {includeDeleted ? ' · 已删除' : ''}
            </span>
            {hasFilter ? (
              <button type="button" className="btn btn--link t-xs" onClick={resetFilters}>
                清空条件
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {/* 分类快速筛选：与供应商页的「类型」同一套 chip，点一下只看这一类 */}
      <div className="flex items-center gap-[var(--space-2)] flex-wrap mt-[var(--space-4)]">
        <span className="t-xs t-3">合同分类</span>
        <button
          type="button"
          className={cx('chip', category === '' && 'chip--on')}
          aria-pressed={category === ''}
          onClick={() => {
            setCategory('');
            setPage(1);
          }}
        >
          全部 <span className="num">{allCount}</span>
        </button>
        {CONTRACT_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={cx('chip', category === c.value && 'chip--on')}
            aria-pressed={category === c.value}
            onClick={() => {
              setCategory(c.value);
              setPage(1);
            }}
          >
            {c.label}
            {counts[c.value] ? <span className="num">{counts[c.value]}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-[var(--space-4)]">
        {state === 'loading' ? <TableSkeleton rows={8} cols={7} /> : null}
        {state === 'error' ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {state === 'ready' && rows.length === 0 ? (
          <EmptyState
            icon={<IconContract size={24} />}
            title={hasFilter ? '这个条件下没有合同。' : '还没有合同。'}
            body={
              hasFilter
                ? '放宽一点再试：公司名输两个字就够，日期可以先留空。'
                : '新建一份合同，把合同电子版、报价单和结算资料传上去——以后翻合同就不用再问行政要文件了。'
            }
          />
        ) : null}

        {state === 'ready' && rows.length > 0 ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>合同名称</Th>
                    <Th>甲方（公司）</Th>
                    <Th>乙方（客户）</Th>
                    <Th>签订时间</Th>
                    <Th align="right">合同金额</Th>
                    <Th>关联报价单</Th>
                    <Th>附件</Th>
                    <Th>最后更新</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const deleted = r.deletedAt !== null;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => {
                          setDrawerId(r.id);
                          setDrawerOpen(true);
                        }}
                        style={{ cursor: 'pointer' }}
                        className={cx(deleted && 't-3')}
                      >
                        <Td>
                          <div className="flex items-center gap-[var(--space-2)] min-w-0">
                            <Badge tone="neutral">{contractCategoryLabel(r.category)}</Badge>
                            <span className="truncate">{r.title}</span>
                          </div>
                          <span className="cell-sub truncate">
                            {r.contractNo ? <span className="num">{r.contractNo}</span> : '没有编号'}
                          </span>
                        </Td>
                        <Td>
                          <div className="truncate">{r.companyName}</div>
                        </Td>
                        <Td>
                          <div className="truncate">
                            {r.customerName || <span className="t-3">—</span>}
                          </div>
                        </Td>
                        <Td>
                          {r.signedOn ? (
                            <span className="num t-sm">{formatDate(r.signedOn)}</span>
                          ) : (
                            <span className="t-3 t-xs">没填</span>
                          )}
                        </Td>
                        <Td align="right">
                          {r.amount ? (
                            <span className="num">{formatMoney(r.amount, { symbol: true })}</span>
                          ) : (
                            <span className="t-3">—</span>
                          )}
                        </Td>
                        <Td>
                          {r.quoteCount > 0 ? (
                            <span className="num t-sm">{r.quoteCount} 张</span>
                          ) : r.fileCounts.quote > 0 ? (
                            <span className="t-xs t-3">只有电子版</span>
                          ) : (
                            <Badge tone="warn">未关联</Badge>
                          )}
                          {r.quoteCount > 0 && r.fileCounts.quote > 0 ? (
                            <span className="cell-sub">+{r.fileCounts.quote} 份电子版</span>
                          ) : null}
                        </Td>
                        <Td>
                          {r.fileCount > 0 ? (
                            <span className="inline-flex items-center gap-[var(--space-1)] num t-sm">
                              <IconPaperclip size={14} />
                              {r.fileCount}
                            </span>
                          ) : (
                            <Badge tone="warn">未上传</Badge>
                          )}
                          {r.fileCount > 0 ? (
                            <span className="cell-sub">
                              合同 {r.fileCounts.contract} · 报价 {r.fileCounts.quote} · 结算{' '}
                              {r.fileCounts.settlement}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="t-xs t-3">{formatTimeRel(r.updatedAt)}</span>
                          {deleted ? (
                            <span className="cell-sub">
                              <Badge tone="neutral">已删除</Badge>
                            </span>
                          ) : null}
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-[var(--space-3)]">
                            <button
                              type="button"
                              className="btn btn--link"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawerId(r.id);
                                setDrawerOpen(true);
                              }}
                            >
                              {deleted ? '查看' : '编辑'}
                            </button>
                            {deleted ? (
                              isAdmin ? (
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
                              ) : null
                            ) : isAdmin ? (
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
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

            <div className="tbl-foot">
              <span>
                共 <span className="num">{total}</span> 份
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

      <ContractDrawer
        open={drawerOpen}
        contractId={drawerId}
        onClose={() => setDrawerOpen(false)}
        onChanged={(message) => {
          setToast(message);
          void load();
        }}
      />
      <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
