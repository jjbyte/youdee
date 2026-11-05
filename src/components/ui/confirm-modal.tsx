'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { Button } from './button';
import { Modal } from './overlay';
import { Note } from './states';

export interface ConfirmSpec {
  title: string;
  /** 一句话说清"点了会发生什么" */
  body: ReactNode;
  /** 需要额外提醒的后果（连带删掉什么、影响谁） */
  warn?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** 请求本身。抛错就留在弹窗里显示原文，不关窗——用户要能看着错误再试一次 */
  run: () => Promise<void>;
}

/**
 * 作废 / 恢复 / 删除 的共用确认框。
 *
 * 三处细节是刻意统一的：
 *   ① 忙态由弹窗自持，确认按钮锁住——删两次会在第二次拿到 404，
 *      用户看到的是「出错了」，不是「已经删了」；
 *   ② 失败不关窗，错误显示在弹窗里。关掉再弹一条 toast，等于把
 *      "为什么没删掉"这句话扔到屏幕角落，而用户正盯着按钮；
 *   ③ 文案由调用方给，组件不编话。作废说"随时能恢复"，删除说"删了就没了"，
 *      两句话的差别就是这两类动作的全部区别，不能由组件统一措辞抹平。
 */
export function ConfirmModal({
  spec,
  onClose,
  onDone,
}: {
  spec: ConfirmSpec | null;
  onClose: () => void;
  /**
   * 可选：动作成功后的收尾。**别在这里写提示文案**——run() 里通常已经写好了一句
   * 更具体的话（"QT-0003 已作废。要反悔就点恢复"），从这里再塞一句"作废"
   * 会把那句话覆盖掉，用户最后看到的只是按钮的名字。
   */
  onDone?: (label: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 换一条 spec 就是换一件事，上一件事的报错不能跟着过来
  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [spec]);

  if (!spec) return null;

  const danger = spec.tone !== 'primary';
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={spec.title}
      width="520px"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                await spec.run();
                onDone?.(spec.confirmLabel);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="t-sm">{spec.body}</div>
      {spec.warn ? (
        <Note tone={danger ? 'danger' : 'info'} className="mt-[var(--space-3)]">
          {spec.warn}
        </Note>
      ) : null}
      {error ? <div className="field-error mt-[var(--space-3)]">{error}</div> : null}
    </Modal>
  );
}
