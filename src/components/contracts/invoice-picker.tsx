'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { InvoiceListItem } from '@/lib/types';
import { EM_DASH, formatDate, formatDecimalString } from '@/lib/format';
import { invoiceStatusLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { InlineLoading, Note } from '@/components/ui/states';
import { IconSearch } from '@/components/icons';

/**
 * 合同里挑发票（多选）。
 *
 * 一个输入框搜"号码 / 销售方 / 备注"（走接口的 q，什么都搜）——
 * 挑票的人手上可能只有票号，也可能只记得是哪家开的，让他先选字段是多余的一步。
 *
 * 已经挂上的票**留在列表里但禁选**，不隐藏：隐藏会让人以为"这张票不在系统里"，
 * 然后去重复上传。
 */
export function InvoicePicker({
  open,
  contractId,
  linkedIds,
  onClose,
  onLinked,
}: {
  open: boolean;
  contractId: string | null;
  /** 已挂在这份合同上的发票 id */
  linkedIds: string[];
  onClose: () => void;
  onLinked: (message: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<InvoiceListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setPicked(new Set());
    setError(null);
    void search('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function search(keyword: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.invoices({ q: keyword.trim() || undefined, limit: 20 });
      setRows(r.items);
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function link() {
    if (!contractId || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.linkContractInvoices(contractId, [...picked]);
      onLinked(
        r.linked === picked.size
          ? `已关联 ${r.linked} 张发票。`
          : `已关联 ${r.linked} 张（另外 ${picked.size - r.linked} 张本来就挂着）。`,
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const linked = new Set(linkedIds);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="关联发票"
      width="min(760px, 94vw)"
      footer={
        <>
          <span className="t-xs t-3 mr-auto">
            已选 <span className="num">{picked.size}</span> 张
          </span>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={picked.size === 0 || !contractId} onClick={() => void link()}>
            关联
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-[var(--space-2)]">
        <label className="flex-1 flex flex-col gap-[var(--space-1)]">
          <span className="t-2xs t-3">按发票号码 / 销售方 / 购买方搜</span>
          <Input
            value={term}
            autoFocus
            placeholder="例如 24312000 或 云图"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search(term);
              }
            }}
          />
        </label>
        <Button variant="secondary" icon={<IconSearch size={16} />} loading={loading} onClick={() => void search(term)}>
          搜索
        </Button>
      </div>

      {error ? (
        <div className="field-error mt-[var(--space-3)]" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-[var(--space-3)]">
        {loading && !rows ? (
          <div className="py-[var(--space-6)] flex justify-center">
            <InlineLoading label="正在找票…" />
          </div>
        ) : rows && rows.length === 0 ? (
          <Note tone="neutral">
            没搜到能关联的发票。它可能还没上传，或者号码输的不是全号——号码是精确匹配，输全 20 位或 8 位再搜。
          </Note>
        ) : (
          <ul className="flex flex-col gap-[var(--space-1)] max-h-[46vh] overflow-auto">
            {(rows ?? []).map((r) => {
              const isLinked = linked.has(r.id);
              const on = picked.has(r.id);
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-[var(--space-3)] px-[var(--space-2)] py-[var(--space-2)] border-b border-[var(--border-soft)]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={isLinked}
                    aria-label={`选中发票 ${r.invoiceNo}`}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate t-sm">
                      <span className="num">{r.invoiceNo}</span>
                      <span className="t-2xs t-3">
                        {r.invoiceCode ? ` · 代码 ${r.invoiceCode}` : ' · 全电'}
                      </span>
                    </div>
                    <div className="t-2xs t-3 truncate">
                      销售方 {r.sellerName || EM_DASH} · 开票 {formatDate(r.issuedOn)}
                    </div>
                  </div>
                  <span className="num t-sm">{formatDecimalString(r.totalAmount, { symbol: true })}</span>
                  <Badge tone={r.status === 'red' ? 'danger' : 'neutral'}>{invoiceStatusLabel(r.status)}</Badge>
                  {isLinked ? <Badge tone="info">已挂</Badge> : null}
                  {r.deletedAt ? <Badge tone="warn">已删除</Badge> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="t-2xs t-3 mt-[var(--space-3)]">
        一次显示 20 张。同一张票可以被多份合同引用（一张票对应多个项目时就是这种情况），重复关联不会报错。
      </p>
    </Modal>
  );
}
