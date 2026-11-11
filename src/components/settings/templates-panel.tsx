'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { QuoteTemplate } from '@/lib/types';
import type { LayoutIssue } from '@/domain/template-layout';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { IconDownload, IconEyeOn, IconPencil, IconPlus, IconRestore } from '@/components/icons';
import { TemplatePreview } from './template-preview';

/**
 * 报价单模板（设置 › 报价单模板）。
 *
 * 模板里放两类东西：
 *   1. 每张单一模一样的**供应商名称**；
 *   2. 可选的一份 **Excel 版式**——列有哪些、什么顺序、表头写什么、抬头怎么排。
 *
 * 客户名称、项目名称、报价日期、有效期、报价人、电话都是从单据或系统设置算出来的，
 * 不进模板：同一份模板印出两种事实（模板里是 A 客户，单子上是 B 客户）是这类系统
 * 最容易出的错，而且只有客户会发现。
 *
 * 改模板不影响历史单：建单时供应商名称和版式都已经快照进那张单了。
 */
export function TemplatesPanel() {
  const [items, setItems] = useState<QuoteTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuoteTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [preview, setPreview] = useState<QuoteTemplate | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.quoteTemplates();
      setItems(r.items ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  async function downloadSample() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.downloadTemplateSample();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '报价单模板-样例.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="panel">
        <div className="flex items-start justify-between gap-[var(--space-3)] mb-[var(--space-3)]">
          <div className="min-w-0">
            <div className="fw-semi t-sm">报价单模板</div>
            <p className="t-2xs t-3 mt-[var(--space-1)]">
              新建报价单时选一个。决定客户版抬头印的「供应商名称」，以及上传了 Excel 的那份版式。
              改模板不改已经建好的单。
            </p>
          </div>
          <div className="flex items-center gap-[var(--space-2)]" style={{ flex: 'none' }}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconDownload size={16} />}
              loading={downloading}
              onClick={() => void downloadSample()}
            >
              下载样例
            </Button>
            <Button variant="secondary" size="sm" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              新建模板
            </Button>
          </div>
        </div>

        {flash ? (
          <div className="t-xs t-success mb-[var(--space-2)]" role="status">
            {flash}
          </div>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        {!items && !error ? <InlineLoading label="正在读模板…" /> : null}

        {items ? (
          items.length === 0 ? (
            <p className="t-sm t-3">还没有模板。新建一个，或者直接建单——没有模板时抬头那格印「—」。</p>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>模板名</Th>
                    <Th>供应商名称（印在抬头）</Th>
                    <Th>版式</Th>
                    <Th>默认</Th>
                    <Th>状态</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <Td>{t.name}</Td>
                      <Td>{t.supplierName || <span className="t-3">—</span>}</Td>
                      <Td>
                        {t.layout ? (
                          <Badge tone="info">Excel 版式</Badge>
                        ) : (
                          <span className="t-2xs t-3">系统默认</span>
                        )}
                      </Td>
                      <Td>{t.isDefault ? <Badge tone="info">默认</Badge> : null}</Td>
                      <Td>
                        {t.isActive ? <span className="t-xs">启用</span> : <span className="t-xs t-3">已停用</span>}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center gap-[var(--space-1)] justify-end">
                          <IconButton label={`预览模板「${t.name}」的客户版`} onClick={() => setPreview(t)}>
                            <IconEyeOn size={16} />
                          </IconButton>
                          <IconButton label={`编辑模板「${t.name}」`} onClick={() => setEditing(t)}>
                            <IconPencil size={16} />
                          </IconButton>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )
        ) : null}
      </div>

      <Note tone="neutral">
        抬头里的客户名称、项目名称、报价日期、有效期、报价人、电话都来自单据本身或当前登录的人，
        模板不需要、也不允许配它们。上传 Excel 改的是<b>版式</b>：有哪些列、什么顺序、表头写什么、抬头怎么摆。
      </Note>

      <TemplateEditor
        open={creating || !!editing}
        template={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onChanged={(msg) => {
          setFlash(msg);
          void load();
        }}
        onImported={(t, msg) => {
          setFlash(msg);
          void load();
          // 导入完立刻拿一张真单排一遍：版式的问题只有套上真实数据才看得出来
          setPreview(t);
        }}
      />

      <TemplatePreview
        open={!!preview}
        layout={preview?.layout ?? null}
        templateName={preview?.name ?? ''}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function TemplateEditor({
  open,
  template,
  onClose,
  onChanged,
  onImported,
}: {
  open: boolean;
  /** null = 新建 */
  template: QuoteTemplate | null;
  onClose: () => void;
  onChanged: (message: string) => void;
  onImported: (template: QuoteTemplate, message: string) => void;
}) {
  const isCreate = !template;
  const [name, setName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<LayoutIssue[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setSupplierName(template?.supplierName ?? '');
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);
    setError(null);
    setIssues([]);
    setConfirmDelete(false);
    setConfirmReset(false);
  }, [open, template]);

  async function submit() {
    if (!name.trim()) {
      setError('模板名不能空着——建单时下拉里显示的就是它。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        supplierName: supplierName.trim(),
        isDefault,
        // 默认模板必须同时启用，否则新建单会选到一个用不了的模板
        isActive: isDefault ? true : isActive,
      };
      if (isCreate) {
        await api.createQuoteTemplate(body);
        onChanged(`已建好模板「${name.trim()}」。`);
      } else {
        await api.updateQuoteTemplate(template.id, body);
        onChanged(`已保存模板「${name.trim()}」。已建好的单不受影响。`);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadSample() {
    try {
      const blob = await api.downloadTemplateSample();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '报价单模板-样例.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function upload(file: File) {
    if (!name.trim()) {
      setError('先填模板名。导入时要用它建模板，或者指定改哪一个。');
      return;
    }
    setImporting(true);
    setError(null);
    setIssues([]);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('name', name.trim());
      form.set('supplier_name', supplierName.trim());
      if (!isCreate) form.set('template_id', template.id);
      if (isDefault) form.set('is_default', 'true');
      const r = await api.importQuoteTemplate(form);
      setIssues(r.issues ?? []);
      onImported(
        r.template,
        isCreate
          ? `已导入「${r.template.name}」的版式，共 ${r.template.layout?.columns.length ?? 0} 列。`
          : `已更新「${r.template.name}」的版式。已建好的单仍按建单时的版式打印。`,
      );
      onClose();
    } catch (e) {
      // 解析失败时服务端会把逐条问题放在 detail.issues：只给一句「解析失败」等于让人去猜
      if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
        const list = (e.detail as { issues?: LayoutIssue[] }).issues;
        if (Array.isArray(list)) setIssues(list);
      }
      setError(errorMessage(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteQuoteTemplate(template.id);
      onChanged(`已删除模板「${template.name}」。已建好的单抬头还是原样。`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  async function resetLayout() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetTemplateLayout(template.id);
      onChanged(`「${template.name}」已退回系统默认版式。已建好的单不受影响。`);
      setConfirmReset(false);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isCreate ? '新建模板' : '编辑模板'}
      subtitle={isCreate ? '一套抬头配置，建单时可选' : template?.name}
      closeOnScrim={false}
      footer={
        <>
          {!isCreate ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy || importing}>
              删除模板
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={importing}>
            {isCreate ? '建这个模板' : '保存'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <Field label="模板名" htmlFor="tpl-name" required hint="只给你自己看，例如「直客模板」「渠道模板」。">
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：直客模板" />
        </Field>

        <Field
          label="供应商名称"
          htmlFor="tpl-supplier"
          hint="印在客户版抬头「供应商名称」那一格。留空则抬头显示「—」。"
        >
          <Input
            id="tpl-supplier"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="例：广州优得广告有限公司"
          />
        </Field>

        <div className="panel" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-start justify-between gap-[var(--space-3)]">
            <div className="min-w-0">
              <div className="fw-semi t-sm">Excel 版式（可选）</div>
              <p className="t-2xs t-3 mt-[var(--space-1)]">
                先下载样例，在 Excel 里改列顺序、表头文字、抬头排布，再传回来。
                不传就用系统默认版式。
              </p>
            </div>
            <div className="flex items-center gap-[var(--space-2)]" style={{ flex: 'none' }}>
              <Button variant="ghost" size="sm" icon={<IconDownload size={16} />} onClick={() => void downloadSample()}>
                样例
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={importing}
                onClick={() => fileRef.current?.click()}
              >
                上传 xlsx
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </div>
          </div>

          {template?.layout ? (
            <div className="flex items-center justify-between gap-[var(--space-3)] mt-[var(--space-3)]">
              <p className="t-2xs t-2">
                当前：Excel 版式，{template.layout.columns.length} 列（
                {template.layout.columns.map((c) => c.header).join(' / ')}）
              </p>
              <Button variant="ghost" size="sm" icon={<IconRestore size={16} />} onClick={() => setConfirmReset(true)}>
                恢复默认
              </Button>
            </div>
          ) : (
            <p className="t-2xs t-3 mt-[var(--space-3)]">当前：系统默认版式（8 列，备注在最后）。</p>
          )}

          {confirmReset ? (
            <Note tone="danger">
              <p className="t-xs mb-[var(--space-2)]">
                退回系统默认版式？上传的那份 Excel 不再生效，之后新建的单都按默认版式出。
                已建好的单不受影响。
              </p>
              <div className="flex gap-[var(--space-2)]">
                <Button variant="danger" size="sm" loading={busy} onClick={() => void resetLayout()}>
                  确认恢复
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>
                  算了
                </Button>
              </div>
            </Note>
          ) : null}

          {issues.length > 0 ? (
            <div className="mt-[var(--space-3)]">
              <div className="fw-semi t-xs mb-[var(--space-2)]">解析报告</div>
              <ul className="t-2xs" style={{ margin: 0, paddingLeft: 18 }}>
                {issues.slice(0, 12).map((it, i) => (
                  <li key={i} className={it.level === 'error' ? 't-danger' : 't-3'}>
                    {it.where}：{it.message}
                  </li>
                ))}
              </ul>
              {issues.length > 12 ? <p className="t-2xs t-3 mt-[var(--space-1)]">还有 {issues.length - 12} 条…</p> : null}
            </div>
          ) : null}
        </div>

        <label className="switch">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          设为默认
          <span className="t-2xs t-3">（新建单默认选它；全库只能有一个）</span>
        </label>

        <label className="switch">
          <input
            type="checkbox"
            checked={isDefault ? true : isActive}
            disabled={isDefault}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          启用
          <span className="t-2xs t-3">
            {isDefault ? '（默认模板不能停用）' : '（停用后新建单时下拉里不出现，历史单不受影响）'}
          </span>
        </label>

        {confirmDelete ? (
          <Note tone="danger">
            <div className="fw-semi mb-[var(--space-2)]">确定删掉「{template?.name}」？</div>
            <p className="t-xs">
              已经用这个模板建过的报价单不受影响——抬头印的是建单那一刻存下的供应商名称与版式，不是模板现值。
              但以后新建单就选不到它了。
            </p>
            <div className="flex gap-[var(--space-2)] mt-[var(--space-3)]">
              <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
                确认删除
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                算了
              </Button>
            </div>
          </Note>
        ) : null}

        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
