'use client';
import type { ReactNode } from 'react';
import { Input, Select } from '@/components/ui/field';

/**
 * 发票台账的查询条件。
 *
 * 五个维度是财务每天真会用的那几个：**号码（精确）、购买方（模糊）、销售方（模糊）、
 * 开票日期区间、状态**，外加一个"还没挂合同"——挂没挂合同是月底对账的第一步。
 *
 * 为什么号码是精确而购买方/销售方是模糊：票号是抄的，抄错一位就该查不到；
 * 公司名是记的，记不全才是常态。给号码做模糊，搜 "00" 会回来两千张。
 *
 * 状态与"是否已挂合同"用 Select 而不是 chip：chip 会把「全部」也画成一个可选项，
 * 而这里真正的默认值是"不限"，chip 表达不了"一个都没勾"这件事。
 */
export interface InvoiceFilters {
  invoiceNo: string;
  buyer: string;
  seller: string;
  /** yyyy-mm-dd */
  issuedFrom: string;
  issuedTo: string;
  status: '' | 'normal' | 'red';
  /** '' = 不限；linked = 已挂合同；unlinked = 还没挂 */
  contract: '' | 'linked' | 'unlinked';
  /** 仅管理员可见的开关：把软删的票也列出来（恢复入口在这里） */
  includeDeleted: boolean;
}

export const EMPTY_INVOICE_FILTERS: InvoiceFilters = {
  invoiceNo: '',
  buyer: '',
  seller: '',
  issuedFrom: '',
  issuedTo: '',
  status: '',
  contract: '',
  includeDeleted: false,
};

/** 有没有动过条件：决定空态说"换个条件"还是"先传第一张票" */
export function hasInvoiceFilter(f: InvoiceFilters): boolean {
  return Boolean(
    f.invoiceNo.trim()
      || f.buyer.trim()
      || f.seller.trim()
      || f.issuedFrom
      || f.issuedTo
      || f.status
      || f.contract
      || f.includeDeleted,
  );
}

/** 小筛选项：标签在上、控件在下，与合同页、供应商页同一套节奏 */
function label(text: string, node: ReactNode, hint?: string) {
  return (
    <label className="flex flex-col gap-[var(--space-1)]">
      <span className="t-2xs t-3">{text}</span>
      {node}
      {hint ? <span className="t-2xs t-3">{hint}</span> : null}
    </label>
  );
}

export function InvoiceFiltersBar({
  value,
  onChange,
  onReset,
  total,
  isAdmin,
}: {
  value: InvoiceFilters;
  /** 只给变化的键；页码由调用方归 1（改条件还停在第 5 页等于看不到结果） */
  onChange: (patch: Partial<InvoiceFilters>) => void;
  onReset: () => void;
  /** 命中总数（不含分页）。null = 还没加载出来 */
  total: number | null;
  isAdmin: boolean;
}) {
  const touched = hasInvoiceFilter(value);
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex items-end gap-[var(--space-3)] flex-wrap">
        {label(
          '发票号码（精确）',
          <Input
            value={value.invoiceNo}
            placeholder="全电 20 位 / 纸质 8 位"
            aria-label="按发票号码精确查询"
            spellCheck={false}
            style={{ width: 210 }}
            onChange={(e) => onChange({ invoiceNo: e.target.value })}
          />,
        )}
        {label(
          '购买方',
          <Input
            value={value.buyer}
            placeholder="星野科技"
            aria-label="按购买方模糊查询"
            style={{ width: 170 }}
            onChange={(e) => onChange({ buyer: e.target.value })}
          />,
        )}
        {label(
          '销售方',
          <Input
            value={value.seller}
            placeholder="云图文化"
            aria-label="按销售方模糊查询"
            style={{ width: 170 }}
            onChange={(e) => onChange({ seller: e.target.value })}
          />,
        )}
      </div>

      <div className="flex items-end gap-[var(--space-3)] flex-wrap">
        {label(
          '开票日期',
          <span className="flex items-center gap-[var(--space-2)]">
            <Input
              type="date"
              value={value.issuedFrom}
              aria-label="开票日期起"
              style={{ width: 146 }}
              onChange={(e) => onChange({ issuedFrom: e.target.value })}
            />
            <span className="t-3">~</span>
            <Input
              type="date"
              value={value.issuedTo}
              aria-label="开票日期止"
              style={{ width: 146 }}
              onChange={(e) => onChange({ issuedTo: e.target.value })}
            />
          </span>,
        )}
        {label(
          '状态',
          <Select
            value={value.status}
            aria-label="发票状态筛选"
            style={{ width: 130 }}
            onChange={(e) => onChange({ status: e.target.value as InvoiceFilters['status'] })}
          >
            <option value="">全部</option>
            <option value="normal">正常</option>
            <option value="red">冲红</option>
          </Select>,
        )}
        {label(
          '是否已挂合同',
          <Select
            value={value.contract}
            aria-label="是否已挂合同筛选"
            style={{ width: 130 }}
            onChange={(e) => onChange({ contract: e.target.value as InvoiceFilters['contract'] })}
          >
            <option value="">全部</option>
            <option value="linked">已挂合同</option>
            <option value="unlinked">还没挂</option>
          </Select>,
          '挂上合同才对得上账',
        )}
        {isAdmin
          ? label(
              '删除状态',
              <Select
                value={value.includeDeleted ? 'deleted' : 'live'}
                aria-label="删除状态筛选"
                style={{ width: 110 }}
                onChange={(e) => onChange({ includeDeleted: e.target.value === 'deleted' })}
              >
                <option value="live">在用</option>
                <option value="deleted">已删除</option>
              </Select>,
              /* 切到「已删除」后合计会把已删的票一起算进来——这句话放在下拉旁边，
                 比只在上方统计卡解释更早一秒被看到 */
              '含已删除时合计无对账意义',
            )
          : null}

        <span className="ml-auto flex items-center gap-[var(--space-3)]">
          <span className="t-xs t-3">
            共 <span className="num">{total ?? '—'}</span> 张
            {value.includeDeleted ? ' · 含已删除' : ''}
          </span>
          {touched ? (
            <button type="button" className="btn btn--link t-xs" onClick={onReset}>
              清空条件
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
