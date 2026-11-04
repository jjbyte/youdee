'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { taxBasisLabel } from '@/lib/labels';
import type { QuoteDetail, TaxBasis } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';
import { InlineLoading } from '@/components/ui/states';

type Preview = Awaited<ReturnType<typeof api.taxBasisPreview>>;

/**
 * 切换口径的确认框（§C.7 / TC-4C）。
 *
 * 三个必选项一条都不能少：
 *   ① 切换**前后的整单合计** —— 没有这个数字的确认框只是免责声明，不是提示；
 *   ② 区分**自动定价行与手工定价行** —— 前者改金额，后者只改毛利；
 *   ③ 预告**会变缺价的行** —— 否则他点完发现某行红了，会以为是 bug。
 *
 * 方向不许写死：标题动词、`换成「X」`、按钮文案、两个合计数字的先后，
 * 全部由 from / to 两个变量拼，含税→不含税与不含税→含税都要能跑。
 */
export function TaxSwitchModal({
  open,
  quote,
  to,
  onClose,
  onConfirm,
  confirming,
}: {
  open: boolean;
  quote: QuoteDetail;
  to: TaxBasis;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .taxBasisPreview(quote.id, to)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, quote.id, to]);

  const from = quote.taxStatement;
  const changed = preview?.summary.changedLines ?? 0;
  const example = preview?.affectedLines.find((l) => l.newCost !== null && l.newCost !== l.oldCost);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`换口径要重新取成本价`}
      width="560px"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={confirming} disabled={loading || !!error} onClick={onConfirm}>
            {changed > 0 ? `换，重算 ${changed} 行` : `换，重算`}
          </Button>
        </>
      }
    >
      {loading ? <InlineLoading label="正在算换口径之后的价格…" /> : null}
      {error ? <Note tone="danger">{error}</Note> : null}

      {preview && !loading ? (
        <div className="flex flex-col gap-[var(--space-4)]">
          <p className="t-sm">
            换成「{taxBasisLabel(to)}」后，系统会重新查每一行的成本价：
          </p>

          <ul className="flex flex-col gap-[var(--space-2)] t-sm t-2">
            <li>
              · <span className="num">{preview.summary.changedLines}</span> 行成本会变，其中{' '}
              <span className="num">{preview.summary.autoPricedLines}</span> 行是自动定价（对客价跟着变）
            </li>
            <li>
              · <span className="num">{preview.summary.manualPricedLines}</span> 行是手工定价，只有毛利变，对客价不动
            </li>
            {preview.summary.missingAfter > 0 ? (
              <li className="t-warning">
                · 另有 <span className="num">{preview.summary.missingAfter}</span> 行只有{taxBasisLabel(from)}价，
                切过去会变成缺价（对客价保持原值，不清零）
              </li>
            ) : null}
          </ul>

          <div className="flex items-baseline gap-[var(--space-3)]">
            <span className="t-sm t-3">整单合计</span>
            <span className="num t-md t-3">{formatMoney(preview.summary.totalBefore, { symbol: true })}</span>
            <span className="t-3">→</span>
            <span className="num" style={{ fontSize: 18, fontWeight: 'var(--fw-semibold)' }}>
              {formatMoney(preview.summary.totalAfter, { symbol: true })}
            </span>
          </div>

          {example ? (
            <div className="note">
              <span className="t-xs">
                举例：{example.supplierNameSnapshot ?? example.itemNameSnapshot} {taxBasisLabel(from)}{' '}
                <span className="num">{formatMoney(example.oldCost, { symbol: true })}</span> /{' '}
                {taxBasisLabel(to)} <span className="num">{formatMoney(example.newCost, { symbol: true })}</span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
