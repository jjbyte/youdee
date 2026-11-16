'use client';
import { useEffect, useRef, useState } from 'react';
import type { InvoiceListItem } from '@/lib/types';
import { cx, EM_DASH, formatDate, formatDecimalString } from '@/lib/format';
import { INVOICE_AMOUNT_CHECK_TEXT, invoiceStatusLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { IconPaperclip } from '@/components/icons';

/**
 * 发票列表。
 *
 * 四条硬规矩（都是对账场景逼出来的）：
 *
 * 1. **金额按字符串渲染**（formatDecimalString），全表不出现一次 Number()。
 *    1900.10 → "1,900.10"，不是 1900.1。
 * 2. **冲红的三个金额显示负号 + 危险色，但不整行涂色**：整行底色会把「未挂合同」
 *    这类副信息一起染色，人反而看不到它；负号和颜色已经足够区分。
 * 3. **首列（号码）冻结**：横向滚到"价税合计"时还得知道自己在看哪张票。
 *    列多就横向滚，不靠缩字号硬塞。
 * 4. 空的金额显示 "—"，不显示 0 —— 0 会被当成"这张票金额是零"。
 */
export function InvoiceTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: InvoiceListItem[];
  /** 勾选的发票 id：只用于「下载勾选」 */
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: InvoiceListItem) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));
  const { scrollRef, moreRight } = useMoreRight();

  return (
    <div className="relative">
      <TableWrap scrollRef={scrollRef}>
        <Table className="min-w-[1100px]">
        <thead>
          <tr>
            <Th sticky>
              <span className="flex items-center gap-[var(--space-2)]">
                <input
                  type="checkbox"
                  aria-label={allChecked ? '取消全选本页' : '全选本页'}
                  checked={allChecked}
                  ref={(el) => {
                    // 部分选中要画成"横杠"，否则人会以为全选失败
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={onToggleAll}
                />
                发票号码
              </span>
            </Th>
            <Th>开票日期</Th>
            <Th>购买方</Th>
            <Th>销售方</Th>
            <Th align="right">金额（不含税）</Th>
            <Th align="right">税额</Th>
            <Th align="right">价税合计</Th>
            <Th>状态</Th>
            <Th align="right">已挂合同</Th>
            <Th align="right">原件</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const red = r.status === 'red';
            const deleted = r.deletedAt !== null;
            const picked = selected.has(r.id);
            const amountTone = red ? 't-danger' : undefined;
            const check = INVOICE_AMOUNT_CHECK_TEXT[r.amountCheck] ?? '';
            return (
              <tr
                key={r.id}
                data-selected={picked || undefined}
                style={{ cursor: 'pointer' }}
                className={cx(deleted && 't-3')}
                onClick={() => onOpen(r)}
              >
                <Td sticky>
                  <div className="flex items-center gap-[var(--space-3)] min-w-0">
                    <input
                      type="checkbox"
                      checked={picked}
                      aria-label={`选中发票 ${r.invoiceNo}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggle(r.id)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-[var(--space-2)]">
                        <span className="num t-sm truncate">{r.invoiceNo}</span>
                        {deleted ? <Badge tone="neutral">已删除</Badge> : null}
                      </div>
                      <span className="cell-sub truncate max-w-[200px]">
                        {r.invoiceCode ? `代码 ${r.invoiceCode}` : '全电 · 无代码'}
                        {r.invoiceTypeLabel ? ` · ${r.invoiceTypeLabel}` : ''}
                      </span>
                    </div>
                  </div>
                </Td>

                <Td>
                  {r.issuedOn ? (
                    <span className="num t-sm">{formatDate(r.issuedOn)}</span>
                  ) : (
                    <span className="t-xs t-3" title="这张票没认出发票日期，不是拿上传日代替">
                      {EM_DASH}
                    </span>
                  )}
                </Td>

                <Td>
                  <div className="truncate max-w-[220px]" title={r.buyerName || undefined}>
                    {r.buyerName || <span className="t-3">{EM_DASH}</span>}
                  </div>
                </Td>

                <Td>
                  <div className="truncate max-w-[220px]" title={r.sellerName || undefined}>
                    {r.sellerName || <span className="t-3">{EM_DASH}</span>}
                  </div>
                </Td>

                <Td align="right">
                  <AmountCell value={r.amount} tone={amountTone} />
                </Td>
                <Td align="right">
                  <AmountCell value={r.taxAmount} tone={amountTone} />
                </Td>
                <Td align="right">
                  <AmountCell value={r.totalAmount} tone={amountTone} strong />
                  {check ? (
                    <span className={cx('cell-sub', r.amountCheck === 'mismatch' && 't-warning')}>{check}</span>
                  ) : null}
                </Td>

                <Td>
                  <Badge tone={red ? 'danger' : 'neutral'}>{invoiceStatusLabel(r.status)}</Badge>
                  {r.statusSource === 'manual' ? (
                    <span className="cell-sub" title="人工改过的状态，不会被重新识别覆盖">
                      人工改过
                    </span>
                  ) : null}
                </Td>

                <Td align="right">
                  {r.contractCount > 0 ? (
                    <span className="num t-sm">{r.contractCount}</span>
                  ) : (
                    <span className="t-3" title="这张票还没挂到任何合同上">
                      {EM_DASH}
                    </span>
                  )}
                </Td>

                <Td align="right">
                  {r.fileCount > 0 ? (
                    <span className="num t-sm inline-flex items-center gap-[var(--space-1)]">
                      <IconPaperclip size={14} />
                      {r.fileCount}
                    </span>
                  ) : (
                    <span className="t-3" title="没有原件（手工录入的票）">
                      {EM_DASH}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
        </Table>
      </TableWrap>
      {/* 右边还有列才挂这条渐变；滚到最右整个移除（不是改透明度） */}
      {moreRight ? <span className="tbl-more" aria-hidden="true" /> : null}
    </div>
  );
}

/**
 * "右边还有内容吗"。
 *
 * 三个时刻都要重算：挂载、滚动、容器尺寸变化（窗口缩放 / 侧栏折叠 / 字体加载完）。
 * 判据用 `scrollLeft + clientWidth >= scrollWidth - 1`——留 1px 容差，
 * 因为亚像素缩放下浏览器可能永远差个 0.5，那时提示就永远不消失。
 */
function useMoreRight() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setMoreRight(el.scrollWidth > el.clientWidth + 1 && !atEnd);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);

  return { scrollRef, moreRight };
}

function AmountCell({
  value,
  tone,
  strong,
}: {
  value: string | null;
  tone?: string;
  strong?: boolean;
}) {
  if (value === null || value === undefined || value === '') {
    return (
      <span className="t-3" title="这张票没认出来金额，不计入合计">
        {EM_DASH}
      </span>
    );
  }
  return (
    <span className={cx('num t-sm', strong && 'fw-med', tone)}>
      {formatDecimalString(value, { symbol: false })}
    </span>
  );
}
