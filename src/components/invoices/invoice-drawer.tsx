'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { InvoiceDetail } from '@/lib/types';
import { cx, EM_DASH, formatDate, formatTimeRel } from '@/lib/format';
import { INVOICE_AMOUNT_CHECK_TEXT, invoiceDisplayStatus } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/overlay';
import { InlineLoading, Note } from '@/components/ui/states';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { IconTrash } from '@/components/icons';
import { useInvoiceConfirmActions } from './use-invoice-confirm';import { InvoiceLinkedContracts } from './invoice-linked-contracts';
import { InvoiceOriginals } from './invoice-originals';
import {
  EMPTY_INVOICE_FORM,
  InvoiceEditFields,
  invoiceFormFrom,
  invoicePayload,
  validateInvoiceForm,
  type InvoiceFormState,
} from './invoice-edit-fields';

/**
 * 发票详情 / 编辑抽屉。`invoiceId === null` 时是「手工录入」（无原件）。
 *
 * 三个刻意的取舍：
 *   ① **票面性质**（红字票，决定金额负号）与**账面状态**（已冲红，只是标签）分成两处改，
 *      且「已冲红」要先确认——它会改"这张票还算不算数"这个判断，但不改金额；
 *   ② 原件与字段同屏，因为对账就是"看一眼票面 → 改一个字段"来回跳；
 *   ③ 已删除的票整块只读，不给人"改了才发现存不上"。
 */
export function InvoiceDrawer({
  open,
  invoiceId,
  isAdmin,
  onClose,
  onChanged,
}: {
  open: boolean;
  /** null = 手工录入一张新票（无原件） */
  invoiceId: string | null;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(invoiceId);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [form, setForm] = useState<InvoiceFormState>(EMPTY_INVOICE_FORM);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** 原件预览层是否开着（见下面 escDisabled 的说明） */
  const [previewOpen, setPreviewOpen] = useState(false);

  /** 连点两条票时，先发的响应不能盖掉后选的 */
  const loadSeq = useRef(0);
  /** 正文滚动容器：错误横幅在顶部时要把用户从按钮那儿拉回来看一眼 */
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentId(invoiceId);
  }, [invoiceId]);

  /* 抽屉关掉 / 换一张票，上一张的预览层不能留在"开着"的状态里：
     InvoiceOriginals 会被卸载（预览自己没了），而这里的状态还在，
     下次打开抽屉 Esc 就永远不响应了。 */
  useEffect(() => {
    setPreviewOpen(false);
  }, [invoiceId, open]);

  const load = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      setForm(EMPTY_INVOICE_FORM);
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const d = await api.invoice(id);
      if (seq !== loadSeq.current) return;
      setDetail(d);
      setForm(invoiceFormFrom(d));
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(errorMessage(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
    setConfirm(null);
    if (!invoiceId) {
      setCurrentId(null);
      setDetail(null);
      setForm(EMPTY_INVOICE_FORM);
      return;
    }
    void load(invoiceId);
  }, [open, invoiceId, load]);

  /**
   * 服务端能指到具体字段时（`field`），错误只写在那个输入框下面，不再同时挂顶部横幅——
   * 同一句话出现两次，人会以为有两处错。
   *
   * 没给 `field` 的（40901 撞号那句 71 个字的话，结论和"怎么办"拆开就都读不通）整条打顶部，
   * 并把正文滚回顶部：用户是在底部点保存的，不滚这条错误正好在他屏幕外。
   * 全文不许截断 —— 被吃掉的半句恰好是"接下来怎么做"。
   */
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.field) {
      const key = e.field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      setFieldErrors({ [key]: e.message });
      return;
    }
    setError(errorMessage(e));
    bodyRef.current?.scrollTo({ top: 0 });
  }

  async function save() {
    setError(null);
    setFieldErrors({});
    const issues = validateInvoiceForm(form);
    if (Object.keys(issues).length > 0) {
      setFieldErrors(issues);
      return;
    }
    setBusy(true);
    try {
      const payload = invoicePayload(form);
      const d = currentId ? await api.updateInvoice(currentId, payload) : await api.createInvoice(payload);
      setDetail(d);
      setForm(invoiceFormFrom(d));
      setCurrentId(d.id);
      onChanged(
        currentId
          ? '发票已保存。'
          : '票已记下。原件之后可以在列表页「批量上传发票」里补——会按「代码 + 号码」合并到这张票。',
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  /** 改状态 / 删除 / 恢复——三段话在 use-invoice-confirm.ts 里，接口和措辞放一起 */
  const { confirm, setConfirm, askStatus, askDelete, askRestore } = useInvoiceConfirmActions({
    currentId,
    detail,
    apply: (d) => {
      setDetail(d);
      setForm(invoiceFormFrom(d));
    },
    onChanged,
    onClose,
  });

  const deleted = detail?.deletedAt != null;
  const checkText = detail ? (INVOICE_AMOUNT_CHECK_TEXT[detail.amountCheck] ?? '') : '';
  /* 新建态还没落库，用表单里的红字票勾选算；有 detail 时两边一致（保存后一起回填） */
  const displayStatus = invoiceDisplayStatus({
    isRedLetter: form.isRedLetter,
    status: detail?.status ?? 'normal',
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={currentId ? `发票 ${form.invoiceNo || ''}` : '手工录入发票'}
      subtitle={
        currentId && detail ? (
          <span>
            {detail.invoiceTypeLabel || '票种未识别'} · 创建 {formatTimeRel(detail.createdAt)}
            {detail.updatedAt !== detail.createdAt ? ` · 最后改于 ${formatTimeRel(detail.updatedAt)}` : ''}
          </span>
        ) : (
          '没有原件也能先记一笔：票号、购买方、销售方必填，金额可以留空待补'
        )
      }
      width="720px"
      closeOnScrim={false}
      bodyRef={bodyRef}
      /* 上面叠了确认框或预览时让路：三层都在 document 上听 Esc，不让路会一起关掉 */
      escDisabled={confirm !== null || previewOpen}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {currentId ? '关闭' : '先不记'}
          </Button>
          <Button variant="primary" loading={busy} disabled={deleted} onClick={() => void save()}>
            {currentId ? '保存修改' : '保存'}
          </Button>
        </>
      }
    >
      {loading ? <InlineLoading label="正在读这张票…" /> : null}

      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}

      {deleted ? (
        <Note tone="warn">
          这张票已被删除，只读查看。统计里不再包含它；原件与已挂的合同都还在。
          {isAdmin ? '确认无误就点下面的「恢复」。' : '需要恢复请找管理员。'}
        </Note>
      ) : null}

      {/* ── 状态 ── */}
      <div className="flex items-center gap-[var(--space-3)] flex-wrap">
        <span className="t-2xs t-3">状态</span>
        {/*
          一个徽标，三选一：红字票 > 已冲红 > 正常（见 invoiceDisplayStatus）。
          红字票是票面性质，但它盖过「正常」——票面是负数、状态却写正常，只会让人以为系统错了。
          新建态还没落库，用表单里的勾选状态算。
        */}
        <Badge tone={displayStatus.tone}>{displayStatus.label}</Badge>
        {detail?.statusSource === 'manual' ? (
          <span className="t-2xs t-3">人工改过（重新识别不会覆盖）</span>
        ) : null}
        {detail?.isRedLetter && detail.originalInvoiceNo ? (
          <span className="t-2xs t-3 num">冲的是原票 {detail.originalInvoiceNo}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {isAdmin && currentId && detail && !deleted ? (
          detail.isRedLetter ? (
            /* 红字票本身是冲减凭证，再标「已冲红」等于说"这张票被另一张票冲了"，对不上账 */
            <span className="t-2xs t-3">红字票不能再标「已冲红」——要标的是它冲的那张原票</span>
          ) : (
            <button
              type="button"
              className={cx('btn btn--link t-xs', detail.status === 'red' ? '' : 't-danger')}
              onClick={() => askStatus(detail.status === 'red' ? 'normal' : 'red')}
              title="只改标签，不动金额：抵账的负数由红字票那一行带着"
            >
              {detail.status === 'red' ? '改回正常（只改标签）' : '标记为已冲红（金额不变）'}
            </button>
          )
        ) : null}
        {!isAdmin ? <span className="t-2xs t-3">改状态找管理员</span> : null}
      </div>

      <InvoiceEditFields
        form={form}
        errors={fieldErrors}
        invoiceTypeLabel={detail?.invoiceTypeLabel ?? null}
        disabled={deleted}
        autoFocusNo={!currentId}
        amountCheckText={checkText}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
      />

      <InvoiceOriginals
        invoiceId={currentId}
        files={detail?.files ?? []}
        hasSaved={Boolean(currentId)}
        disabled={deleted}
        onPreviewOpenChange={setPreviewOpen}
        onAttached={(next, fileName) => {
          /* 只换 detail，**不碰 form**：补原件跟用户正在改的金额、号码没关系，回填会冲掉他改了一半的内容 */
          setDetail(next);
          onChanged(`原件已挂上：${fileName}`);
        }}
      />

      <div className="pt-[var(--space-4)] border-t border-[var(--border)]">
        <InvoiceLinkedContracts
          invoiceId={currentId}
          items={detail?.contracts ?? []}
          disabled={deleted}
          onChanged={async (message) => {
            await load(currentId);
            onChanged(message);
          }}
        />
      </div>

      {/* ── 元信息 / 删除 ── */}
      <div className="pt-[var(--space-4)] border-t border-[var(--border)] flex items-center gap-[var(--space-3)] flex-wrap">
        <span className="t-2xs t-3">
          {detail?.issuedOn ? `开票日期 ${formatDate(detail.issuedOn)}` : `开票日期 ${EM_DASH}`}
          {detail?.invoiceCode ? ` · 代码 ${detail.invoiceCode}` : ' · 全电无代码'}
        </span>
        <span style={{ flex: 1 }} />
        {isAdmin && currentId && detail ? (
          deleted ? (
            <Button variant="secondary" size="sm" onClick={() => askRestore()}>
              恢复这张票
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<IconTrash size={14} />}
              className="t-danger"
              onClick={() => askDelete()}
            >
              删除发票
            </Button>
          )
        ) : null}
      </div>

      <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />
    </Drawer>
  );
}
