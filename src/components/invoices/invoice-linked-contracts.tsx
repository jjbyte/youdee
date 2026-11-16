'use client';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { InvoiceLinkedContract } from '@/lib/types';
import { cx } from '@/lib/format';
import { contractStatusLabel } from '@/domain/contract';
import { Badge } from '@/components/ui/badge';
import { Note } from '@/components/ui/states';
import { IconContract } from '@/components/icons';

/**
 * 发票抽屉里的「已关联合同」。
 *
 * 为什么这半边只能解除、不能新增：关联动作要按合同找票（"这张合同的钱是哪几张票开的"），
 * 入口放在合同抽屉的「关联发票」里。发票侧再放一个"挑合同"的入口，
 * 就会出现两条写入路径，而多对多的边只有一份——两边各写一套，早晚对不上。
 */
export function InvoiceLinkedContracts({
  invoiceId,
  items,
  disabled,
  onChanged,
}: {
  invoiceId: string | null;
  items: InvoiceLinkedContract[];
  /** 发票已软删时不允许改关联（先恢复再改） */
  disabled?: boolean;
  onChanged: (message: string) => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unlink(c: InvoiceLinkedContract) {
    if (!invoiceId) return;
    setBusyId(c.id);
    setError(null);
    try {
      await api.unlinkContractInvoice(invoiceId, c.id);
      await onChanged(`已从「${c.title}」上摘掉这张票。`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)]">
        <IconContract size={16} />
        <span className="fw-semi t-sm">已关联合同</span>
        {items.length > 0 ? <Badge tone="neutral">{items.length} 份</Badge> : null}
        <span className="t-2xs t-3 ml-auto">挂合同在合同抽屉里做（合同 → 关联发票）</span>
      </div>

      {items.length === 0 ? (
        <Note tone="neutral">
          这张票还没挂到任何合同上。月底对账时"这张票是哪份合同的开销"就答不上来——
          到合同里点「关联发票」把它挂上。
        </Note>
      ) : (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {items.map((c) => (
            <li
              key={c.id}
              className={cx(
                'flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]',
                'border border-[var(--border)] rounded-[var(--radius-md)]',
                c.deleted && 't-3',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate t-sm">{c.title}</div>
                <div className="t-2xs t-3 truncate">
                  {c.contractNo ? <span className="num">{c.contractNo}</span> : '没有编号'}
                  {c.companyName ? ` · ${c.companyName}` : ''}
                </div>
              </div>
              {c.status ? <Badge tone="neutral">{contractStatusLabel(c.status)}</Badge> : null}
              {c.deleted ? <Badge tone="warn">合同已删除</Badge> : null}
              {disabled ? null : c.deleted ? null : (
                <button
                  type="button"
                  className="btn btn--link t-xs"
                  disabled={busyId === c.id}
                  onClick={() => void unlink(c)}
                >
                  解除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <div className="field-error mt-[var(--space-2)]" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
