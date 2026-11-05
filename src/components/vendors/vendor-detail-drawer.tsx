'use client';
import { formatMoney, formatTimeRel } from '@/lib/format';
import { UNIT_LABELS, supplierTypeLabel } from '@/lib/labels';
import { invoiceFilledCount } from '@/domain/invoice-info';
import type { Price, Supplier } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/overlay';
import { InlineLoading, Note } from '@/components/ui/states';
import { TableWrap } from '@/components/ui/table';

/**
 * 供应商详情抽屉（§C.6，480px）。
 *
 * 用抽屉不用整页：信息量不足以撑满一页，且常从比价区就地查看。
 * 内容 = 基本信息 / 该供应商全部报价 / 备注。
 */
export function VendorDetailDrawer({
  detail,
  prices,
  loading,
  isAdmin,
  onClose,
  onEdit,
  onDelete,
}: {
  detail: Supplier | null;
  prices: Price[];
  loading: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
}) {
  return (
    <Drawer
      open={Boolean(detail)}
      onClose={onClose}
      title={detail?.name ?? ''}
      subtitle={
        detail ? (
          <span>
            {supplierTypeLabel(detail.type)} · {detail.priceCount ?? 0} 条报价 · 最后更新{' '}
            {formatTimeRel(detail.updatedAt)}
          </span>
        ) : null
      }
      width="var(--vendor-drawer-w)"
      footer={
        <>
          {isAdmin && detail ? (
            <Button variant="ghost" onClick={() => onDelete(detail)}>
              删除供应商
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            关掉
          </Button>
          {isAdmin && detail ? (
            <Button variant="primary" onClick={() => onEdit(detail)}>
              编辑档案
            </Button>
          ) : null}
        </>
      }
    >
      {detail ? (
        <div className="flex flex-col gap-[var(--space-5)]">
          <div className="panel">
            <div className="fw-semi t-sm mb-[var(--space-3)]">基本信息</div>
            <dl className="grid grid-cols-2 gap-[var(--space-3)] t-xs">
              <div>
                <dt className="t-3">类型</dt>
                <dd>{supplierTypeLabel(detail.type)}</dd>
              </div>
              <div>
                <dt className="t-3">地区</dt>
                <dd>{detail.region || '—'}</dd>
              </div>
              <div>
                <dt className="t-3">联系人</dt>
                <dd>{detail.contactName || '—'}</dd>
              </div>
              <div>
                <dt className="t-3">电话</dt>
                <dd className="num">{detail.contactPhone || '—'}</dd>
              </div>
              <div>
                <dt className="t-3">默认交期</dt>
                <dd>{detail.defaultLeadTimeDays ? `${detail.defaultLeadTimeDays} 天` : '—'}</dd>
              </div>
              <div>
                <dt className="t-3">店铺链接</dt>
                <dd>
                  {detail.shopUrl ? (
                    <a href={detail.shopUrl} target="_blank" rel="noreferrer" className="btn btn--link">
                      打开
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
            {detail.note ? <p className="t-xs t-2 mt-[var(--space-3)]">{detail.note}</p> : null}
          </div>

          {/*
            开票信息：五项填了才显示。空数组时整块不出现——一块全是「—」的表，
            会让人以为这里出错了，而实际上只是还没填。
          */}
          {invoiceFilledCount({
            tax_no: detail.taxNo,
            company_address: detail.companyAddress,
            company_phone: detail.companyPhone,
            bank_name: detail.bankName,
            bank_account: detail.bankAccount,
          }) > 0 ? (
            <div className="panel">
              <div className="fw-semi t-sm mb-[var(--space-3)]">开票信息</div>
              <dl className="grid grid-cols-2 gap-[var(--space-3)] t-xs">
                <div className="col-span-2">
                  <dt className="t-3">纳税人识别号</dt>
                  <dd className="num-code">{detail.taxNo || '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="t-3">公司地址</dt>
                  <dd>{detail.companyAddress || '—'}</dd>
                </div>
                <div>
                  <dt className="t-3">联系电话</dt>
                  <dd className="num-code">{detail.companyPhone || '—'}</dd>
                </div>
                <div>
                  <dt className="t-3">开户银行</dt>
                  <dd>{detail.bankName || '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="t-3">银行账号</dt>
                  <dd className="num-code">{detail.bankAccount || '—'}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div>
            <div className="fw-semi t-sm mb-[var(--space-2)]">这家报过的价</div>
            {loading ? <InlineLoading label="正在读报价…" /> : null}
            {!loading && prices.length === 0 ? (
              <p className="t-xs t-3">这家还没报过价。录价的时候选它，就会出现在这里。</p>
            ) : null}
            {prices.length > 0 ? (
              <TableWrap maxHeight="320px">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">物料 · 单位</th>
                      <th scope="col" className="ta-r">
                        单价
                      </th>
                      <th scope="col">更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prices.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="truncate">{p.itemName}</div>
                          <span className="cell-sub">
                            /{UNIT_LABELS[p.unitCode] ?? p.unitCode} · {p.taxIncluded ? '含税' : '不含税'}
                          </span>
                        </td>
                        <td className="ta-r num">{formatMoney(p.unitPrice, { symbol: true })}</td>
                        <td className="t-xs t-3">{formatTimeRel(p.effectiveFrom)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : null}
          </div>

          <Note tone="neutral">
            要改价，去那个物料的比价页「新建一条价」——历史不会被覆盖，旧价会在新价生效前一天结束。
          </Note>
        </div>
      ) : null}
    </Drawer>
  );
}
