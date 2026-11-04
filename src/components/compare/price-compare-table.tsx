'use client';
import { formatMoney, formatQty } from '@/lib/format';
import { effectiveStateLabel, supplierTypeLabel, tierCaseText, unitLabel } from '@/lib/labels';
import type { CompareResult, ItemType, TaxBasis } from '@/lib/types';
import type { RankedRow } from '@/lib/compare-local';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { IconRuler, IconRisk } from '@/components/icons';

/**
 * 表格视图（§D.1.2，次选，给数字党和老 Excel 手）。
 *
 * 与卡片视图共享同一个 qty 状态，切换不重置。
 * 表格可以纵向滚动看全，所以**保留所有分组**（不像卡片受 Tab 限制），用分隔行断开。
 * 缺失报价**不从「供应商全集 − 有价行」自己推**，只读接口的 missing_suppliers[]。
 */
export function PriceCompareTable({
  groups,
  itemType,
  compareUnitCode,
  compareUnitName,
  pageTaxBasis,
  missingSuppliers,
  selectedId,
  onSelect,
}: {
  groups: Array<{ key: string; label: string; ranked: RankedRow[] }>;
  itemType: ItemType;
  compareUnitCode: string;
  compareUnitName?: string | null;
  pageTaxBasis: TaxBasis;
  missingSuppliers: NonNullable<CompareResult['missingSuppliers']>;
  selectedId: string | null;
  onSelect: (row: RankedRow) => void;
}) {
  const cmpUnit = unitLabel(compareUnitCode, compareUnitName);

  return (
    <TableWrap maxHeight="calc(100dvh - 320px)">
      <Table className="cmp-tbl">
        <thead>
          <tr>
            <Th sticky>供应商</Th>
            <Th sticky>类型</Th>
            <Th align="right">单价 / {cmpUnit}</Th>
            <Th>命中档</Th>
            <Th>含税</Th>
            <Th align="right">起订量</Th>
            <Th align="right">交期</Th>
            <Th>有效期</Th>
            <Th>状态</Th>
          </tr>
        </thead>

        {groups.map((g) => (
          <tbody key={g.key}>
            <tr>
              <td
                colSpan={9}
                style={{
                  background: 'var(--surface-sunken)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--fw-semibold)',
                  color: 'var(--fg-2)',
                }}
              >
                {g.label} · {g.ranked.length} 家
              </td>
            </tr>
            {g.ranked.map((r) => {
              const notComparable = r.exclusive === 'UNIT_NOT_COMPARABLE';
              const shownUnit = notComparable ? unitLabel(r.row.unitCode) : cmpUnit;
              const shownPrice = notComparable ? r.hit.unitPrice : r.hit.baseUnitPrice;
              const isLowest = r.isLowest && r.exclusive === null;
              return (
                <tr
                  key={r.row.priceId}
                  data-selected={selectedId === r.row.priceId || undefined}
                  onClick={() => r.exclusive === null && onSelect(r)}
                  style={{ cursor: r.exclusive === null ? 'pointer' : 'default' }}
                >
                  <Td sticky>
                    <span className="inline-flex items-center gap-[var(--space-2)]">
                      {isLowest ? <Badge tone={r.isLowestTied ? 'lowest-tie' : 'lowest'}>{r.isLowestTied ? '最低 · 并列' : '最低'}</Badge> : null}
                      <span className="truncate" title={r.row.supplierName}>
                        {r.row.supplierName}
                      </span>
                      {r.row.supplierType === 'internal' ? <Badge tone="internal">自有</Badge> : null}
                    </span>
                  </Td>
                  <Td sticky>{supplierTypeLabel(r.row.supplierType, itemType)}</Td>
                  <Td align="right">
                    <span
                      className="num"
                      style={{
                        fontWeight: isLowest ? 'var(--fw-semibold)' : undefined,
                        background: isLowest ? 'var(--price-lowest-bg)' : undefined,
                        color: isLowest ? 'var(--success)' : undefined,
                        padding: '0 var(--space-1)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {formatMoney(shownPrice, { symbol: true })}
                    </span>
                    {notComparable ? (
                      <span className="ml-[var(--space-2)]" title="单位不一致，不进排序、不参与最低价">
                        <IconRuler size={16} className="t-warning" />
                      </span>
                    ) : null}
                    <span className="t-2xs t-3 ml-[var(--space-1)]">/{shownUnit}</span>
                  </Td>
                  <Td>
                    <span
                      className={
                        r.hit.tierCase === 'in_tier'
                          ? 't-xs t-success'
                          : r.hit.tierCase === 'no_tiers'
                            ? 't-xs t-3'
                            : 't-xs t-warning'
                      }
                    >
                      {r.row.tiers.length === 0 ? '无阶梯' : tierCaseText(r.hit.tierCase, r.hit.range)}
                    </span>
                  </Td>
                  <Td>{r.row.taxIncluded ? '含税' : '不含税'}</Td>
                  <Td align="right">
                    {r.row.moq ? `${formatQty(r.row.moq)} ${unitLabel(r.row.unitCode)}` : '—'}
                  </Td>
                  <Td align="right">{r.row.defaultLeadTimeDays ? `${r.row.defaultLeadTimeDays} 天` : '—'}</Td>
                  <Td>{r.row.effectiveTo ?? '长期'}</Td>
                  <Td>
                    {r.exclusive === null || r.exclusive === 'PRICE_EXPIRED' ? null : (
                      <Badge tone="warn" icon={<IconRisk size={16} />}>
                        {r.exclusive === 'UNIT_NOT_COMPARABLE'
                          ? '单位不同'
                          : r.exclusive === 'TAX_BASIS_MISMATCH'
                            ? `只有${r.row.taxIncluded ? '含税' : '不含税'}价`
                            : '口径不同'}
                      </Badge>
                    )}
                    {r.exclusive === 'TAX_BASIS_MISMATCH' ? (
                      <span className="t-2xs t-3 ml-[var(--space-1)]">
                        本页按{pageTaxBasis === 'inclusive' ? '含税' : '不含税'}
                      </span>
                    ) : null}
                    {r.expired ? <span className="t-2xs t-3">{effectiveStateLabel(r.row.effectiveState)}</span> : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        ))}

        {missingSuppliers.length > 0 ? (
          <tbody>
            <tr>
              <td
                colSpan={9}
                style={{
                  background: 'var(--surface-sunken)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-3)',
                }}
              >
                有历史报价、今天没有有效价（{missingSuppliers.length} 家）——不是「没报价」，是这一天的价用不了
              </td>
            </tr>
            {missingSuppliers.map((m) => (
              <tr key={m.supplierId}>
                <Td sticky>{m.supplierName}</Td>
                <Td sticky>{supplierTypeLabel(m.supplierType, itemType)}</Td>
                <Td align="right" className="t-3">
                  —
                </Td>
                <Td colSpan={6} className="t-3 t-xs">
                  这家没报这个物料（历史价今天不生效）
                </Td>
              </tr>
            ))}
          </tbody>
        ) : null}
      </Table>
    </TableWrap>
  );
}
