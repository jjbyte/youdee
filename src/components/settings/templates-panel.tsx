'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { QuoteTemplate } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { IconPencil, IconPlus } from '@/components/icons';

/**
 * 报价单模板（设置 › 报价单模板）。
 *
 * 模板里只放**每张单一模一样**的东西：供应商名称。
 * 客户名称、项目名称、报价日期、有效期、报价人、电话都是从单据或系统设置算出来的——
 * 把它们塞进模板，同一份模板就会印出两种事实（模板里是 A 客户，单子上是 B 客户）。
 *
 * 改模板不影响历史单：建单时 supplier_name 已经快照进那张单了。
 * 这条在这里用一句话写清楚，否则管理员会以为「改一下模板所有单都跟着变」而不敢改。
 */
export function TemplatesPanel() {
  const [items, setItems] = useState<QuoteTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuoteTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="panel">
        <div className="flex items-start justify-between gap-[var(--space-3)] mb-[var(--space-3)]">
          <div className="min-w-0">
            <div className="fw-semi t-sm">报价单模板</div>
            <p className="t-2xs t-3 mt-[var(--space-1)]">
              新建报价单时选一个，决定客户版抬头印的「供应商名称」。改模板不改已经建好的单。
            </p>
          </div>
          <Button variant="secondary" size="sm" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            新建模板
          </Button>
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
                      <Td>{t.isDefault ? <Badge tone="info">默认</Badge> : null}</Td>
                      <Td>
                        {t.isActive ? <span className="t-xs">启用</span> : <span className="t-xs t-3">已停用</span>}
                      </Td>
                      <Td align="right">
                        <IconButton label={`编辑模板「${t.name}」`} onClick={() => setEditing(t)}>
                          <IconPencil size={16} />
                        </IconButton>
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
        抬头一共五组：单号 / 供应商名称；客户名称 / 项目名称；报价日期 / 有效期；活动日期 / 税口径；
        报价人 / 联系电话。除了供应商名称，其余全部来自单据本身或当前登录的人——
        所以模板不需要、也不允许配它们。
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
      />
    </div>
  );
}

function TemplateEditor({
  open,
  template,
  onClose,
  onChanged,
}: {
  open: boolean;
  /** null = 新建 */
  template: QuoteTemplate | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const isCreate = !template;
  const [name, setName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setSupplierName(template?.supplierName ?? '');
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);
    setError(null);
    setConfirmDelete(false);
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
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
              删除模板
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
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
              已经用这个模板建过的报价单不受影响——抬头印的是建单那一刻存下的供应商名称，不是模板现值。
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
