'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { ContractDetail, ContractFile, ContractFileCategory, QuoteListItem } from '@/lib/types';
import { cx, formatDate, formatMoney, formatTimeRel } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { InlineLoading, Note } from '@/components/ui/states';
import {
  IconExternal,
  IconFile,
  IconPaperclip,
  IconPlus,
  IconQuote,
  IconSearch,
  IconTrash,
} from '@/components/icons';

/**
 * 合同详情 / 编辑抽屉。
 *
 * 两条设计取舍：
 *
 * 1. **新建和编辑是同一个抽屉**。合同这种表最怕"先建个空壳再回头补"，
 *    因为补的人常常不是建的人；所以新建保存成功后不关抽屉，直接切到编辑态，
 *    让"关联报价单 / 传合同电子版 / 传结算资料"这几步接着做完。
 *
 * 2. **附件分三个抽屉**，不是一个大列表：合同正文是法律凭据、报价单是商务依据、
 *    结算资料是对账凭据，翻的人目的不同。混在一起等于每次都从头找。
 */

interface FormState {
  title: string;
  companyName: string;
  customerName: string;
  projectName: string;
  contractNo: string;
  signedOn: string;
  amount: string;
  note: string;
}

const EMPTY: FormState = {
  title: '',
  companyName: '',
  customerName: '',
  projectName: '',
  contractNo: '',
  signedOn: '',
  amount: '',
  note: '',
};

function toForm(d: ContractDetail): FormState {
  return {
    title: d.title,
    companyName: d.companyName,
    customerName: d.customerName ?? '',
    projectName: d.projectName ?? '',
    contractNo: d.contractNo ?? '',
    signedOn: d.signedOn ?? '',
    amount: d.amount ?? '',
    note: d.note ?? '',
  };
}

function fileSize(n: number): string {
  if (n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 服务端 field 是 snake_case，表单键是 camelCase */
function camel(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 三类附件的文案与 accept。
 * 与 `src/server/services/file-type.ts` 的 FILE_CATEGORY 一一对应——
 * 前端 accept 只决定"选择框里能选什么"，真正的判定在服务端按字节做。
 */
const SECTIONS: {
  key: ContractFileCategory;
  title: string;
  hint: string;
  accept: string;
  empty: string;
}[] = [
  {
    key: 'contract',
    title: '合同电子版',
    hint: 'PDF / JPG / PNG / Word',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx',
    empty: '还没传合同正文。扫描件、对方发来的 Word 版都行，一份合同可以传多份（正文 + 补充协议）。',
  },
  {
    key: 'quote',
    title: '报价单',
    hint: 'PDF / JPG / PNG / Excel',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx',
    empty: '系统里有这张单就在上面「关联报价单」里选；没有就传电子版。',
  },
  {
    key: 'settlement',
    title: '结算资料',
    hint: 'PDF / JPG / PNG / Excel / Word',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx',
    empty: '还没传结算资料。对账单、验收单、结算清单都可以传在这儿。',
  },
];

const QUOTE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  issued: { label: '已发出', tone: 'info' },
  void: { label: '已作废', tone: 'danger' },
};

export function ContractDrawer({
  open,
  contractId,
  onClose,
  onChanged,
}: {
  open: boolean;
  /** null = 新建 */
  contractId: string | null;
  onClose: () => void;
  /** 保存成功 / 附件或关联变动后通知列表刷新（文案由抽屉给，列表只管弹） */
  onChanged: (message: string) => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(contractId);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<ContractFileCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmFileId, setConfirmFileId] = useState<string | null>(null);

  // 关联报价单
  const [quoteQuery, setQuoteQuery] = useState('');
  const [quoteResults, setQuoteResults] = useState<QuoteListItem[] | null>(null);
  const [quoteSearching, setQuoteSearching] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const contractInput = useRef<HTMLInputElement>(null);
  const quoteInput = useRef<HTMLInputElement>(null);
  const settlementInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentId(contractId);
  }, [contractId]);

  const load = useCallback(async () => {
    if (!currentId) {
      setDetail(null);
      setForm(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const d = await api.contract(currentId);
      setDetail(d);
      setForm(toForm(d));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
    setConfirmFileId(null);
    setQuoteQuery('');
    setQuoteResults(null);
    setQuoteError(null);
    if (!contractId) {
      // 重新打开"新建"时不能残留上一份的表单
      setCurrentId(null);
      setDetail(null);
      setForm(EMPTY);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contractId]);

  function handleError(e: unknown) {
    setError(errorMessage(e));
    if (e instanceof ApiError && e.field) {
      setFieldErrors({ [camel(e.field)]: e.message });
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        title: form.title.trim(),
        companyName: form.companyName.trim(),
        // 乙方可以空着：不是每份合同都能一眼看出客户主体
        customerName: form.customerName.trim() || null,
        projectName: form.projectName.trim() || null,
        contractNo: form.contractNo.trim() || null,
        signedOn: form.signedOn || null,
        amount: form.amount.trim() || null,
        note: form.note.trim() || null,
      };
      const d = currentId ? await api.updateContract(currentId, payload) : await api.createContract(payload);
      setDetail(d);
      setForm(toForm(d));
      setCurrentId(d.id);
      onChanged(currentId ? '合同已保存。' : '合同已建好，接着传合同电子版、关联报价单吧。');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function upload(category: ContractFileCategory, files: FileList | null) {
    if (!files || files.length === 0 || !currentId) return;
    const section = SECTIONS.find((s) => s.key === category)!;
    setUploading(category);
    setError(null);
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('category', category);
      try {
        await api.uploadContractFile(currentId, fd);
      } catch (e) {
        failed.push(`${f.name}：${errorMessage(e)}`);
      }
    }
    if (category === 'contract' && contractInput.current) contractInput.current.value = '';
    if (category === 'quote' && quoteInput.current) quoteInput.current.value = '';
    if (category === 'settlement' && settlementInput.current) settlementInput.current.value = '';
    await load();
    setUploading(null);
    if (failed.length) setError(failed.join('；'));
    else onChanged(`${section.title}已上传。`);
  }

  async function removeFile(fileId: string) {
    if (!currentId) return;
    setConfirmFileId(null);
    setBusy(true);
    try {
      await api.deleteContractFile(currentId, fileId);
      await load();
      onChanged('附件已删除。');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function searchQuotes() {
    setQuoteSearching(true);
    setQuoteError(null);
    try {
      const r = await api.quotes({ q: quoteQuery.trim() || undefined, limit: 8 });
      const linked = new Set((detail?.quotes ?? []).map((q) => q.id));
      setQuoteResults(r.items.filter((q) => !linked.has(q.id)));
    } catch (e) {
      setQuoteError(errorMessage(e));
    } finally {
      setQuoteSearching(false);
    }
  }

  async function linkQuote(quoteId: string) {
    if (!currentId) return;
    setLinkingId(quoteId);
    try {
      await api.linkContractQuote(currentId, quoteId);
      await load();
      setQuoteResults((rs) => (rs ?? []).filter((q) => q.id !== quoteId));
      onChanged('已关联报价单。');
    } catch (e) {
      setQuoteError(errorMessage(e));
    } finally {
      setLinkingId(null);
    }
  }

  async function unlinkQuote(quoteId: string) {
    if (!currentId) return;
    setLinkingId(quoteId);
    try {
      await api.unlinkContractQuote(currentId, quoteId);
      await load();
      onChanged('已取消关联。');
    } catch (e) {
      setQuoteError(errorMessage(e));
    } finally {
      setLinkingId(null);
    }
  }

  const files = detail?.files ?? [];
  const quotes = detail?.quotes ?? [];
  const isDeleted = detail?.deletedAt != null;
  const filesOf = (c: ContractFileCategory) => files.filter((f) => f.category === c);

  const inputFor = (c: ContractFileCategory) =>
    c === 'contract' ? contractInput : c === 'quote' ? quoteInput : settlementInput;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={currentId ? form.title || '合同详情' : '新建合同'}
      subtitle={
        currentId ? (
          <span>
            创建 {detail ? formatTimeRel(detail.createdAt) : '—'}
            {detail?.createdByName ? ` · ${detail.createdByName}` : ''}
          </span>
        ) : (
          '先填基本信息，保存后可以关联报价单、上传合同电子版'
        )
      }
      width="760px"
      closeOnScrim={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {currentId ? '关闭' : '先不建'}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {currentId ? '保存修改' : '保存'}
          </Button>
        </>
      }
    >
      {loading ? <InlineLoading label="正在读合同…" /> : null}

      {error ? (
        <div className="field-error mb-[var(--space-3)]" role="alert">
          {error}
        </div>
      ) : null}

      {isDeleted ? (
        <div className="mb-[var(--space-4)]">
          <Note tone="warn">这份合同已经被删除，管理员可以在列表勾「已删除」后把它恢复。</Note>
        </div>
      ) : null}

      <div className="flex flex-col gap-[var(--space-4)]">
        <Field label="合同名称" htmlFor="ct-title" required error={fieldErrors.title}>
          <Input
            id="ct-title"
            value={form.title}
            autoFocus={!currentId}
            placeholder="2026 秋季新品发布会 · 活动执行合同"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field
            label="公司名称（甲方）"
            htmlFor="ct-company"
            required
            hint="我方签约主体；按它查合同"
            error={fieldErrors.companyName}
          >
            <Input
              id="ct-company"
              value={form.companyName}
              placeholder="星野科技有限公司"
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            />
          </Field>
          <Field label="客户名称（乙方）" htmlFor="ct-customer" hint="签约的客户主体" error={fieldErrors.customerName}>
            <Input
              id="ct-customer"
              value={form.customerName}
              placeholder="云图文化传播有限公司"
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="合同编号" htmlFor="ct-no" error={fieldErrors.contractNo}>
            <Input
              id="ct-no"
              value={form.contractNo}
              placeholder="不填也行"
              onChange={(e) => setForm((f) => ({ ...f, contractNo: e.target.value }))}
            />
          </Field>
          <Field label="项目名称" htmlFor="ct-project" error={fieldErrors.projectName}>
            <Input
              id="ct-project"
              value={form.projectName}
              placeholder="秋季新品发布会"
              onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="签订日期" htmlFor="ct-signed" error={fieldErrors.signedOn}>
            <Input
              id="ct-signed"
              type="date"
              value={form.signedOn}
              onChange={(e) => setForm((f) => ({ ...f, signedOn: e.target.value }))}
            />
          </Field>
          <Field label="合同金额（元）" htmlFor="ct-amount" error={fieldErrors.amount}>
            <Input
              id="ct-amount"
              inputMode="decimal"
              value={form.amount}
              placeholder="未记录就留空"
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="备注" htmlFor="ct-note" error={fieldErrors.note}>
          <Textarea
            id="ct-note"
            rows={2}
            value={form.note}
            placeholder="付款节点、对方联系人、补充约定……"
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>
      </div>

      {/* ── 关联系统报价单 ── */}
      <div className="mt-[var(--space-6)] pt-[var(--space-4)] border-t border-[var(--border)]">
        <div className="flex items-center justify-between gap-[var(--space-3)] mb-[var(--space-2)]">
          <div className="flex items-center gap-[var(--space-2)]">
            <IconPaperclip size={16} />
            <span className="fw-semi t-sm">系统报价单</span>
            {quotes.length > 0 ? <Badge tone="neutral">{quotes.length} 张</Badge> : null}
          </div>
          <span className="t-2xs t-3">没有的话，在下面传报价单电子版</span>
        </div>

        {!currentId ? (
          <Note tone="neutral">先把合同保存下来，再来关联报价单。</Note>
        ) : (
          <>
            {quotes.length > 0 ? (
              <ul className="flex flex-col gap-[var(--space-2)] mb-[var(--space-3)]">
                {quotes.map((q) => (
                  <li
                    key={q.id}
                    className={cx(
                      'flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)]',
                      q.deleted && 't-3',
                    )}
                  >
                    <IconQuote size={16} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate t-sm">
                        <span className="num">{q.quoteNo}</span>
                        {q.version > 1 ? <span className="t-3"> v{q.version}</span> : null}
                        <span className="t-2xs t-3"> · {q.customerName}</span>
                      </div>
                      <div className="t-2xs t-3 truncate">
                        {q.eventName} · {formatMoney(q.totalPrice, { symbol: true })}
                        {q.issuedAt ? ` · 发出于 ${formatDate(q.issuedAt.slice(0, 10))}` : ''}
                      </div>
                    </div>
                    <Badge tone={q.deleted ? 'neutral' : (QUOTE_STATUS[q.status]?.tone ?? 'neutral')}>
                      {q.deleted ? '已删除' : (QUOTE_STATUS[q.status]?.label ?? q.status)}
                    </Badge>
                    {isDeleted ? null : (
                      <button
                        type="button"
                        className="btn btn--link t-xs"
                        disabled={linkingId === q.id}
                        onClick={() => void unlinkQuote(q.id)}
                      >
                        取消关联
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {isDeleted ? null : (
              <div className="flex items-end gap-[var(--space-2)]">
                <label className="flex-1 flex flex-col gap-[var(--space-1)]">
                  <span className="t-2xs t-3">按单号 / 客户 / 活动名搜报价单</span>
                  <Input
                    value={quoteQuery}
                    placeholder="例如 云图 或 Q2026"
                    onChange={(e) => setQuoteQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void searchQuotes();
                      }
                    }}
                  />
                </label>
                <Button
                  variant="secondary"
                  icon={<IconSearch size={16} />}
                  loading={quoteSearching}
                  onClick={() => void searchQuotes()}
                >
                  搜索
                </Button>
              </div>
            )}

            {quoteError ? (
              <div className="field-error mt-[var(--space-2)]" role="alert">
                {quoteError}
              </div>
            ) : null}

            {quoteResults ? (
              quoteResults.length === 0 ? (
                <p className="t-2xs t-3 mt-[var(--space-2)]">
                  没搜到可关联的报价单。它可能还没建，或者已经关联了——下面传电子版也可以。
                </p>
              ) : (
                <ul className="flex flex-col gap-[var(--space-1)] mt-[var(--space-2)]">
                  {quoteResults.map((q) => (
                    <li key={q.id} className="flex items-center gap-[var(--space-3)] py-[var(--space-1)]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate t-sm">
                          <span className="num">{q.quoteNo}</span>
                          {q.version > 1 ? <span className="t-3"> v{q.version}</span> : null}
                          <span className="t-2xs t-3"> · {q.customerName}</span>
                        </div>
                        <div className="t-2xs t-3 truncate">
                          {q.eventName} · {formatMoney(q.totalPrice, { symbol: true })}
                        </div>
                      </div>
                      <Badge tone={QUOTE_STATUS[q.status]?.tone ?? 'neutral'}>
                        {QUOTE_STATUS[q.status]?.label ?? q.status}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={linkingId === q.id}
                        onClick={() => void linkQuote(q.id)}
                      >
                        关联
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}
      </div>

      {/* ── 三类附件 ── */}
      {SECTIONS.map((s) => {
        const list = filesOf(s.key);
        const ref = inputFor(s.key);
        return (
          <div key={s.key} className="mt-[var(--space-6)] pt-[var(--space-4)] border-t border-[var(--border)]">
            <div className="flex items-center justify-between gap-[var(--space-3)] mb-[var(--space-2)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <span className="fw-semi t-sm">{s.title}</span>
                {list.length > 0 ? <Badge tone="neutral">{list.length} 份</Badge> : null}
                <span className="t-2xs t-3">{s.hint}</span>
              </div>
              <div>
                <input
                  ref={ref}
                  type="file"
                  accept={s.accept}
                  multiple
                  className="hidden"
                  onChange={(e) => void upload(s.key, e.target.files)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconPlus size={16} />}
                  loading={uploading === s.key}
                  disabled={!currentId || uploading !== null || isDeleted}
                  onClick={() => ref.current?.click()}
                >
                  上传{s.title}
                </Button>
              </div>
            </div>

            {!currentId ? (
              <Note tone="neutral">先把合同信息保存下来，再上传——附件要挂在合同上，不能先飘着。</Note>
            ) : list.length === 0 ? (
              <Note tone="neutral">
                {s.empty}
                <span className="t-3"> 单份不超过 20MB。</span>
              </Note>
            ) : (
              <ul className="flex flex-col gap-[var(--space-2)]">
                {list.map((f) => (
                  <ContractFileRow
                    key={f.id}
                    f={f}
                    disabled={isDeleted}
                    busy={busy}
                    confirming={confirmFileId === f.id}
                    onAsk={() => setConfirmFileId(f.id)}
                    onCancel={() => setConfirmFileId(null)}
                    onConfirm={() => void removeFile(f.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {detail?.signedOn ? (
        <p className="t-2xs t-3 mt-[var(--space-4)]">签订日期：{formatDate(detail.signedOn)}</p>
      ) : null}
    </Drawer>
  );
}

/** 附件行。放在模块级而不是抽屉内部：内部函数每次渲染都是新组件，输入框状态会丢 */
function ContractFileRow({
  f,
  disabled,
  busy,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  f: ContractFile;
  disabled: boolean;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const inline = f.ext === 'pdf' || f.kind === 'image';
  return (
    <li className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)]">
      <IconFile size={16} />
      <div className="min-w-0 flex-1">
        <div className="truncate t-sm">{f.originalName || f.id}</div>
        <div className="t-2xs t-3">
          {f.ext ? `${f.ext.toUpperCase()} · ` : ''}
          {fileSize(f.sizeBytes)}
          {f.sizeBytes ? ' · ' : ''}
          {formatTimeRel(f.createdAt)}
        </div>
      </div>
      <a
        href={f.url}
        target="_blank"
        rel="noreferrer"
        className="btn btn--link"
        aria-label={`${inline ? '打开' : '下载'} ${f.originalName || '附件'}`}
      >
        <IconExternal size={14} /> {inline ? '打开' : '下载'}
      </a>
      {confirming ? (
        <span className="flex items-center gap-[var(--space-2)]">
          <button type="button" className="btn btn--link t-danger" onClick={onConfirm}>
            确认删除
          </button>
          <button type="button" className="btn btn--link" onClick={onCancel}>
            取消
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={cx('btn btn--link', disabled && 'disabled')}
          aria-label="删除这份附件"
          disabled={disabled || busy}
          onClick={onAsk}
        >
          <IconTrash size={14} />
        </button>
      )}
    </li>
  );
}
