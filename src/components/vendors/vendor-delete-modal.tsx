'use client';
import { useState } from 'react';
import { api, errorMessage, isApiError } from '@/lib/api';
import type { Supplier } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/**
 * 删除供应商的强确认（§C.6 / §E.3 L2）。
 *
 * 确认文案**不许写"彻底删除""不可恢复"**——附件与历史价都不做物理删除，
 * 已发出的报价单里的数字还是当时的数字。写错事实比不写更糟：
 * 他真的按"不可恢复"做了决定，然后发现记录还在，从此不信任何确认框。
 */
export function VendorDeleteModal({
  supplier,
  onClose,
  onDeleted,
  onError,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onDeleted: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  // 忙态由弹窗自持：请求就发在这里，页面没必要知道中间那一秒。
  // 确认按钮必须锁住——删两次会在第二次拿到 404，用户看到的是「出错了」，不是「已经删了」。
  const [deleting, setDeleting] = useState(false);

  return (
    <Modal
      open={Boolean(supplier)}
      onClose={onClose}
      title={`删掉「${supplier?.name ?? ''}」？`}
      width="520px"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            不删
          </Button>
          <Button
            variant="danger"
            loading={deleting}
            disabled={deleting}
            onClick={async () => {
              if (!supplier || deleting) return;
              setDeleting(true);
              try {
                await api.deleteSupplier(supplier.id);
                await onDeleted('删掉了。它报过的价还留在价格库里。');
              } catch (e) {
                onError(
                  isApiError(e) && e.code === 40904
                    ? e.message
                    : `${errorMessage(e)}（有报价记录的供应商要先处理它的价）`,
                );
              } finally {
                setDeleting(false);
              }
            }}
          >
            确认删掉
          </Button>
        </>
      }
    >
      <p className="t-sm">
        删掉后这家不再出现在录价和比价里。它历史报过的价不会被删除——
        <span className="t-2">已经发出的报价单里那些数字还是当时的数字。</span>
      </p>
      {supplier && (supplier.priceCount ?? 0) > 0 ? (
        <Note tone="warn" className="mt-[var(--space-3)]">
          这家有 {supplier.priceCount} 条报价记录。有价格记录的供应商删不掉——先把那些价停用。
        </Note>
      ) : null}
    </Modal>
  );
}
