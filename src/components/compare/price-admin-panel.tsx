'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { natureLabel, unitLabel } from '@/lib/labels';
import type { Price } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ConfirmModal, type ConfirmSpec } from '@/components/ui/confirm-modal';
import { InlineLoading, Note } from '@/components/ui/states';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { IconArchive, IconChevronDown, IconRestore, IconTrash } from '@/components/icons';
import { useMe } from '@/lib/use-me';
import { canDeleteRecord } from '@/domain/permissions';

/**
 * 价格记录（作废 / 恢复 / 删除）。
 *
 * 为什么单开这一块，而不是把按钮挂到比价卡片上：
 *   比价区只显示**在效**的价——被作废的那条根本不在卡片里，于是"恢复"永远没有入口。
 *   要能恢复，就必须有一个看得见归档记录的地方，而那个地方的排序逻辑（价格高低）
 *   和比价区正好相反（按时间倒序，因为要处理的是"最近录错的那条"）。
 *
 * 三种角色能力在这里第一次同时出现：作废/恢复人人可点，删除只有管理员有。
 */
export function PriceAdminPanel({ itemId, reloadKey, onChanged }: { itemId: string; reloadKey: number; onChanged: () => void }) {
  const { user } = useMe();
  const canDelete = user ? canDeleteRecord(user.role) : false;
  const [open, setOpen] = useState(false);
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = await api.prices({ itemId, limit: 200 });
      setPrices(p.items ?? []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [itemId]);

  // 展不展开都先拉一次：条数要显示在标题上，否则用户不知道该不该点开
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const archivedCount = (prices ?? []).filter((p) => p.status === 'archived').length;

  const act = (spec: ConfirmSpec) => setConfirm(spec);

  return (
    <section className="mt-[var(--space-5)]">
      <button
        type="button"
        className="flex items-center gap-[var(--space-2)] t-sm fw-semi"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconChevronDown size={16} style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }} />
        价格记录
        <span className="t-xs t-3 fw-normal">
          {prices ? `共 ${prices.length} 条` : '…'}
          {archivedCount > 0 ? ` · 已作废 ${archivedCount} 条` : ''}
        </span>
      </button>

      {open ? (
        <div className="mt-[var(--space-3)]">
          {error ? <Note tone="danger">{error}</Note> : null}
          {!prices ? (
            <InlineLoading label="正在读价格记录…" />
          ) : prices.length === 0 ? (
            <Note tone="neutral">还没有任何价格记录。</Note>
          ) : (
            <TableWrap maxHeight="360px">
              <Table>
                <thead>
                  <tr>
                    <Th>供应商</Th>
                    <Th>交易性质</Th>
                    <Th align="right">单价</Th>
                    <Th>有效期</Th>
                    <Th>状态</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => {
                    const archived = p.status === 'archived';
                    return (
                      <tr key={p.id}>
                        <Td>{p.supplierName}</Td>
                        <Td className="t-xs t-2">{natureLabel(p.pricingNature)}</Td>
                        <Td align="right">
                          <span className={archived ? 'num t-3' : 'num'}>
                            {formatMoney(p.unitPrice)}
                            <span className="t-3">/{unitLabel(p.unitCode)}</span>
                          </span>
                        </Td>
                        <Td className="t-xs t-3">
                          {formatDate(p.effectiveFrom)}
                          {p.effectiveTo ? ` 至 ${formatDate(p.effectiveTo)}` : ' 起'}
                        </Td>
                        <Td>
                          <Badge tone={archived ? 'neutral' : p.status === 'superseded' ? 'warn' : 'success'}>
                            {archived ? '已作废' : p.status === 'superseded' ? '已被新价取代' : '在效'}
                          </Badge>
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-[var(--space-3)]">
                            {archived ? (
                              <button
                                type="button"
                                className="btn btn--link"
                                onClick={() =>
                                  act({
                                    title: '恢复这条价？',
                                    body: `${p.supplierName} 这条 ${formatMoney(p.unitPrice)}/${unitLabel(p.unitCode)} 恢复后重新参与比价与取价。`,
                                    warn: '如果这段时间已经有别的同口径价在效，恢复会失败——系统会告诉你是哪家，先把新的作废再恢复这条。',
                                    confirmLabel: '恢复',
                                    tone: 'primary',
                                    run: async () => {
                                      await api.restorePrice(p.id);
                                      setConfirm(null);
                                      await load();
                                      onChanged();
                                    },
                                  })
                                }
                              >
                                <IconRestore size={14} />
                                恢复
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--link"
                                onClick={() =>
                                  act({
                                    title: '作废这条价？',
                                    body: `${p.supplierName} 这条 ${formatMoney(p.unitPrice)}/${unitLabel(p.unitCode)} 不再参与比价和取价，历史报价单不受影响。`,
                                    warn: '作废随时能恢复。录错一条价时，作废比删除对——对方下一轮报价的记录还在。',
                                    confirmLabel: '作废',
                                    run: async () => {
                                      await api.archivePrice(p.id, '录错或不再合作');
                                      setConfirm(null);
                                      await load();
                                      onChanged();
                                    },
                                  })
                                }
                              >
                                <IconArchive size={14} />
                                作废
                              </button>
                            )}
                            {canDelete ? (
                              <button
                                type="button"
                                className="btn btn--link t-danger"
                                onClick={() =>
                                  act({
                                    title: '删掉这条价？',
                                    body: `${p.supplierName} 这条 ${formatMoney(p.unitPrice)}/${unitLabel(p.unitCode)} 会从价格库里彻底消失。`,
                                    warn: '删除不可恢复。已经发出的报价单里的数字不变（行上存的是快照），但趋势图里这条会消失。',
                                    confirmLabel: '确认删掉',
                                    run: async () => {
                                      await api.deletePrice(p.id);
                                      setConfirm(null);
                                      await load();
                                      onChanged();
                                    },
                                  })
                                }
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
          )}
        </div>
      ) : null}

      <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
