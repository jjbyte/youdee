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

  /** 改状态：冲红 ⇄ 正常。金额符号由服务端同步翻转，界面只负责说清后果 */
  function askStatus(next: InvoiceStatus) {
    if (!currentId || !detail) return;
    const toRed = next === 'red';
    setConfirm({
      title: toRed ? '把这张票改成冲红？' : '把这张票改回正常？',
      body: toRed ? (
        <>
          改完后金额、税额、价税合计会<strong>一起变成负数</strong>，合计这个数立刻变小。
          这是抵账的动作，不是把票作废。
        </>
      ) : (
        <>改完后三项金额会变回正数，合计随之变大。发票号、购买方、销售方都不动。</>
      ),
      warn: toRed
        ? '冲红会翻转对账口径，所以只有管理员能做；改完会被记成「人工改过」，重新识别不会覆盖它。'
        : '如果这张其实是红票，改回正常会让合计虚高——确认票面确实是蓝票再改。',
      confirmLabel: toRed ? '改为冲红' : '改回正常',
      tone: toRed ? 'danger' : 'primary',
      run: async () => {
        apply(await api.setInvoiceStatus(currentId, next));
        setConfirm(null);
        onChanged(toRed ? '已标记为冲红，三项金额已转为负数。' : '已改回正常，三项金额已转为正数。');
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
