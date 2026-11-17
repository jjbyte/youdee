'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { InvoiceDetail, InvoiceStatus } from '@/lib/types';
import type { ConfirmSpec } from '@/components/ui/confirm-modal';

/**
 * 发票抽屉里会「问人一句」的三件事：改状态（正常 ⇄ 冲红）、删除、恢复。
 *
 * 单独拎出来不是为了少几行，是因为这三段话是本模块最容易被改坏的东西：
 * 冲红会被当成"作废"、删除会被当成"隐藏"。措辞和它对应的接口放在一起，
 * 改接口的人一定看得见这段话。
 *
 * `run()` 抛错就留在弹窗里显示原文（ConfirmModal 的约定），
 * 所以这里不做 try/catch——吞掉错误等于让人以为改成功了。
 */
export function useInvoiceConfirmActions({
  currentId,
  detail,
  apply,
  onChanged,
  onClose,
}: {
  currentId: string | null;
  detail: InvoiceDetail | null;
  /** 把服务端返回的新快照回填到抽屉（表单 + 只读区一起换） */
  apply: (d: InvoiceDetail) => void;
  onChanged: (message: string) => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  /**
   * 改「已冲红」标签：**只改标签，不动金额**。
   *
   * 这句话必须说明白，因为它和用户直觉相反：多数人以为"标冲红"就等于把钱变负。
   * 实际上抵账的负数由那张红字票自己带着（它是「红字票」，入账时金额就是负的），
   * 这里再翻一次符号，同一对票会被抵两次——合计凭空少掉两个 X。
   */
  function askStatus(next: InvoiceStatus) {
    if (!currentId || !detail) return;
    const toRed = next === 'red';
    setConfirm({
      title: toRed ? '把这张原票标成「已冲红」？' : '把这张票改回「正常」？',
      body: toRed ? (
        <>
          只改这个标签，<strong>金额一分不动</strong>、合计也不变——抵账的负数由冲它的那张红字票带着。
          这行的意思是「这张蓝票已经作废了，别再拿它去对账」。
        </>
      ) : (
        <>改回正常只是把标签撤掉，金额同样不动。适用于"标错了"或者"那张红字票作废了"。</>
      ),
      warn: toRed
        ? '标之前确认一下红字票已经录进台账了；只标标签、没有红字票时，合计里这张票仍然算着。'
        : '撤掉标签不会把红字票一起删掉——那笔负数还在合计里。',
      confirmLabel: toRed ? '标记为已冲红' : '改回正常',
      tone: toRed ? 'danger' : 'primary',
      run: async () => {
        apply(await api.setInvoiceStatus(currentId, next));
        setConfirm(null);
        onChanged(toRed ? '已标记为「已冲红」（金额未改）。' : '已改回「正常」（金额未改）。');
      },
    });
  }

  function askDelete() {
    if (!currentId || !detail) return;
    setConfirm({
      title: `删除发票 ${detail.invoiceNo}？`,
      body: (
        <>
          删掉后这张票从台账里消失，合计里也不再算它。管理员可以在筛选里切「已删除」再恢复。
          {detail.files.length > 0 ? `它的 ${detail.files.length} 份原件一个字节都不会被删。` : ''}
        </>
      ),
      warn: '票是财务凭据。删了之后「这笔钱花在哪张票上」就答不上来了——只是不想看见它的话，先想一下为什么。',
      confirmLabel: '删除',
      run: async () => {
        await api.deleteInvoice(currentId);
        setConfirm(null);
        onChanged(`发票 ${detail.invoiceNo} 已删除。要反悔就在筛选里切「已删除」再恢复。`);
        onClose();
      },
    });
  }

  function askRestore() {
    if (!currentId || !detail) return;
    setConfirm({
      title: '恢复这张发票？',
      body: '恢复后回到默认列表，字段、原件、已挂的合同原样还在。',
      confirmLabel: '恢复',
      tone: 'primary',
      run: async () => {
        apply(await api.restoreInvoice(currentId));
        setConfirm(null);
        onChanged('发票已恢复。');
      },
    });
  }

  return { confirm, setConfirm, askStatus, askDelete, askRestore };
}
