'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { natureLabel } from '@/lib/labels';
import type { Category } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { Toast } from '@/components/ui/overlay';
import { useMe } from '@/lib/use-me';
import { canManageCatalog } from '@/domain/permissions';
import { IconPencil, IconPlus } from '@/components/icons';

/**
 * 分类字典（§C.9）：两棵树，各 8 类，**不设「其他」**。
 *
 * 物料和人不会互相归类（把「主持人」拖进「印刷物料」是荒谬的）。
 * 「其他」会变成一个什么都往里扔的垃圾桶，半年后分类就废了——真的出现第 9 类就让客户自己加一类。
 *
 * 0.1.13 起这一页可维护（**仅管理员**）：改名 + 新增。客户口里的叫法一年会变好几次
 * （「舞美硬体」改成「舞台结构」），以前只能进数据库改，于是分类名和客户说的词越来越对不上，
 * 录价的人就自己往"最像的那个"里塞——分类体系是这么烂掉的，不是没人管，是改不动。
 *
 * 不支持：删除分类。分类下面挂着主体和价，删掉等于让一批记录无处归属；
 * 真要合并分类，正确做法是先把主体移过去（改档案），这一步现在就能做。
 */
export function CategoriesPanel() {
  const { user } = useMe();
  const isAdmin = user ? canManageCatalog(user.role) : false;
  const [material, setMaterial] = useState<Category[] | null>(null);
  const [personnel, setPersonnel] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    Promise.all([api.categories('material'), api.categories('personnel')])
      .then(([m, p]) => {
        setMaterial(Array.isArray(m) ? m : (m.material ?? []));
        setPersonnel(Array.isArray(p) ? p : (p.personnel ?? []));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [reloadKey]);

  const reload = (message?: string) => {
    if (message) setToast(message);
    setReloadKey((k) => k + 1);
  };

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!material || !personnel) return <InlineLoading label="正在读分类…" />;

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-5)]">
        <Tree
          title="物料树"
          hint="这棵树管物料；物料按「交易性质」比价（买断 / 租赁 / 定制加工）"
          domain="material"
          nodes={material}
          isAdmin={isAdmin}
          onChanged={reload}
        />
        <Tree
          title="人员树"
          hint="这棵树管人；人按「计价方式」比价（按天 / 按场 / 按人天）"
          domain="personnel"
          nodes={personnel}
          isAdmin={isAdmin}
          onChanged={reload}
        />
      </div>

      <Note tone="neutral">
        {isAdmin
          ? '可以改名和新增。改名只改显示的名字，已经录进去的物料/人员不会动，历史报价单上的分类快照也不变（那是当时的事实）。'
          : '分类字典只有管理员能改。名称不对、缺一类，跟管理员说一声就行——这一步以前要进数据库改，现在他点两下就好。'}
      </Note>

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function Tree({
  title,
  hint,
  domain,
  nodes,
  isAdmin,
  onChanged,
}: {
  title: string;
  hint: string;
  domain: 'material' | 'personnel';
  nodes: Category[];
  isAdmin: boolean;
  onChanged: (message?: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');

  const startEdit = (c: Category) => {
    setEditing(c.id);
    setDraft(c.name);
    setErr(null);
  };

  const save = async (id: string) => {
    const name = draft.trim();
    if (!name) {
      setErr('名字不能空着。');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.updateCategory(id, { name });
      setEditing(null);
      onChanged(`分类已改名为「${name}」`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      setErr('新分类得有名字。');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createCategory({ domain, name, parentId: newParent || null });
      setNewName('');
      setAdding(false);
      onChanged(`加好了「${name}」`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const nameRow = (c: Category, child: boolean) => (
    <div className="flex items-center gap-[var(--space-2)] py-[var(--space-1)]">
      {editing === c.id ? (
        <>
          <input
            className="input"
            style={{ height: 28, padding: '0 8px', maxWidth: 200 }}
            value={draft}
            autoFocus
            aria-label={`改 ${c.name} 的名字`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save(c.id);
              if (e.key === 'Escape') setEditing(null);
            }}
          />
          <Button size="sm" variant="primary" loading={busy} onClick={() => void save(c.id)}>
            存
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            取消
          </Button>
        </>
      ) : (
        <>
          <span className={child ? 't-xs t-2' : 't-sm'}>{c.name}</span>
          {typeof c.itemCount === 'number' ? <span className="num t-2xs t-3">{c.itemCount}</span> : null}
          <span style={{ flex: 1 }} />
          {child ? null : <span className="t-2xs t-3">{natureLabel(c.effectivePricingNature)}</span>}
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--link"
              aria-label={`改 ${c.name} 的名字`}
              onClick={() => startEdit(c)}
            >
              <IconPencil size={14} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="panel">
      <div className="flex items-center gap-[var(--space-2)]">
        <div className="fw-semi t-sm">{title}</div>
        <span style={{ flex: 1 }} />
        {isAdmin ? (
          <button type="button" className="btn btn--link" onClick={() => setAdding((v) => !v)}>
            <IconPlus size={14} />
            新增
          </button>
        ) : null}
      </div>
      {/* 对齐写死：这一行是说明文字，任何情况下都必须跟标题左对齐 */}
      <div className="t-2xs t-3 mb-[var(--space-3)] num" style={{ textAlign: 'left' }}>
        {hint}
      </div>

      {nodes.length === 0 ? (
        <p className="t-xs t-3">这一类还没有数据。</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-1)]">
          {nodes.map((c) => (
            <li key={c.id}>
              {nameRow(c, false)}
              {c.children && c.children.length > 0 ? (
                <ul className="ml-[var(--space-4)]">
                  {c.children.map((ch) => (
                    <li key={ch.id}>{nameRow(ch, true)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]">
          <input
            className="input"
            placeholder="新分类的名字（例：舞台结构）"
            value={newName}
            aria-label="新分类名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <select
            className="input"
            value={newParent}
            aria-label="挂在哪个分类下"
            onChange={(e) => setNewParent(e.target.value)}
          >
            <option value="">作为一级分类</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                挂在「{n.name}」下
              </option>
            ))}
          </select>
          <div className="flex items-center gap-[var(--space-2)]">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void create()}>
              加上
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {err ? <div className="field-error mt-[var(--space-2)]">{err}</div> : null}
    </div>
  );
}
