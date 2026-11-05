'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { canManageCatalog } from '@/domain/permissions';
import { useMe } from '@/lib/use-me';
import { UNIT_LABELS } from '@/lib/labels';
import type { Category, ItemDetail, ItemType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/**
 * 主体档案编辑（物料 / 人员共用）。
 *
 * 存在的理由：列表页那支铅笔原本跳到比价页，而比价页的「编辑」是个 disabled 占位
 * （tooltip 写着"档案编辑在列表页做"，可列表页并没有这个入口）。
 * 结果是**所有人都只能看、不能改**，管理员也不例外 —— 而 PATCH /items/:id 早就写好了。
 *
 * 一条不能违反的服务端规则在这里提前说清：**已有价格记录后不能改基准单位**（42204）。
 * 换单位等于把历史价全部换口径。所以只要有价，这个下拉就锁住并写明原因，
 * 而不是让用户改完再吃一个 422。
 */

const MATERIAL_UNITS = [
  'sqm',
  'piece',
  'block',
  'sheet',
  'set',
  'group',
  'root',
  'roll',
  'meter',
  'linear_m',
  'day',
  'batch',
];
const PERSONNEL_UNITS = ['session', 'day', 'person_day', 'hour', 'half_day'];

export function ItemEditDrawer({
  itemId,
  itemType,
  open,
  onClose,
  onSaved,
}: {
  itemId: string | null;
  itemType: ItemType;
  open: boolean;
  onClose: () => void;
  onSaved?: (item: ItemDetail) => void;
}) {
  const { user } = useMe();
  const isAdmin = user ? canManageCatalog(user.role) : false;

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [spec, setSpec] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [baseUnitCode, setBaseUnitCode] = useState('');
  const [compareUnitCode, setCompareUnitCode] = useState('');
  const [aliases, setAliases] = useState('');
  const [includesTravel, setIncludesTravel] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const reset = useCallback((d: ItemDetail) => {
    setDetail(d);
    setName(d.name ?? '');
    setSpec(d.spec ?? '');
    setCategoryId(d.categoryId ?? '');
    setBaseUnitCode(d.baseUnitCode ?? '');
    setCompareUnitCode(d.compareUnitCode ?? '');
    setAliases((d.aliases ?? []).join('、'));
    setIncludesTravel(Boolean(d.includesTravel));
    setIsActive(Boolean(d.isActive));
    setError(null);
    setConfirmOff(false);
  }, []);

  useEffect(() => {
    if (!open || !itemId) return;
    let alive = true;
    setLoading(true);
    setDetail(null);
    Promise.all([api.item(itemId), api.categories(itemType).catch(() => null)])
      .then(([d, cats]) => {
        if (!alive) return;
        reset(d);
        const list = !cats ? [] : Array.isArray(cats) ? cats : (cats[itemType] ?? []);
        setCategories(list);
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, itemId, itemType, reset]);

  async function submit() {
    if (!itemId) return;
    setError(null);
    if (!name.trim()) {
      setError('名字不能空着。');
      return;
    }
    if (!categoryId) {
      setError('先选个分类。');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateItem(itemId, {
        name: name.trim(),
        spec: spec.trim() || null,
        categoryId,
        baseUnitCode,
        compareUnitCode: compareUnitCode || null,
        // 分隔符用顿号也认：客户录别名习惯写「背景板、签到墙」
        aliases: aliases
          .split(/[、,，\s]+/)
          .map((a) => a.trim())
          .filter(Boolean),
        includesTravel: itemType === 'personnel' ? includesTravel : undefined,
        isActive,
      });
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!itemId) return;
    setBusy(true);
    try {
      // 作废接口只回 id/name/isActive；这里的回调要一整份 ItemDetail，所以顺手再读一次
      await api.archiveItem(itemId);
      const updated = await api.item(itemId);
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!itemId) return;
    setBusy(true);
    try {
      await api.restoreItem(itemId);
      const updated = await api.item(itemId);
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const hasPrices = (detail?.priceSupplierCount ?? 0) > 0;
  const unitOptions = itemType === 'personnel' ? PERSONNEL_UNITS : MATERIAL_UNITS;
  // 比价基准单位可以留空：留空表示"直接按基准单位比"，不是没填
  const compareOptions = unitOptions.filter((u) => u !== baseUnitCode);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={itemType === 'material' ? '编辑物料档案' : '编辑人员档案'}
      subtitle={detail?.name}
      closeOnScrim={false}
      footer={
        <>
          {/*
            作废 / 恢复不设管理员闸门：作废可逆，成员也能用。
            改档案（保存）仍然是管理员专属——名字一改，所有人口里的叫法就都错了。
          */}
          {detail?.isActive === false ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void restore()}>
              恢复这个主体
            </Button>
          ) : detail ? (
            confirmOff ? (
              <>
                <span className="t-xs t-3">作废后不再出现在列表里，历史报价单还能正常显示。</span>
                <Button variant="secondary" size="sm" onClick={() => setConfirmOff(false)}>
                  不了
                </Button>
                <Button variant="danger" size="sm" loading={busy} onClick={() => void deactivate()}>
                  确认作废
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                作废这个主体
              </Button>
            )
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={!isAdmin || loading || !detail} onClick={() => void submit()}>
            保存
          </Button>
        </>
      }
    >
      {!isAdmin ? (
        <Note tone="warn">档案只有管理员能改。你可以录价、比价、出单。</Note>
      ) : null}

      {loading ? (
        <div className="t-sm t-3">正在读…</div>
      ) : !detail ? (
        <Note tone="danger">{error || '没读到这个主体。'}</Note>
      ) : (
        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="名称" htmlFor="ie-name" required>
            <Input
              id="ie-name"
              value={name}
              disabled={!isAdmin}
              onChange={(e) => setName(e.target.value)}
              placeholder={itemType === 'material' ? '桁架 3m 方管' : '张启明（主持人）'}
            />
          </Field>

          <Field
            label="规格 / 说明"
            htmlFor="ie-spec"
            hint={itemType === 'personnel' ? '例：单场 4 小时，超时另计' : '例：3000×3000'}
          >
            <Input id="ie-spec" value={spec} disabled={!isAdmin} onChange={(e) => setSpec(e.target.value)} />
          </Field>

          <Field label="分类" htmlFor="ie-cat" required>
            <Select id="ie-cat" value={categoryId} disabled={!isAdmin} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={itemType === 'personnel' ? '计价单位' : '基准单位'}
            htmlFor="ie-unit"
            required
            hint={
              hasPrices
                ? `已经有 ${detail.priceSupplierCount} 家报了价，基准单位不能再改 —— 换了单位等于把历史价全部换了口径。`
                : '建好后一旦有价格记录，这个就锁住了。'
            }
          >
            <Select
              id="ie-unit"
              value={baseUnitCode}
              disabled={!isAdmin || hasPrices}
              onChange={(e) => {
                setBaseUnitCode(e.target.value);
                if (compareUnitCode === e.target.value) setCompareUnitCode('');
              }}
            >
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u] ?? u}
                </option>
              ))}
              {unitOptions.includes(baseUnitCode) ? null : (
                <option value={baseUnitCode}>{UNIT_LABELS[baseUnitCode] ?? baseUnitCode}</option>
              )}
            </Select>
          </Field>

          <Field
            label="比价基准单位"
            htmlFor="ie-cmp-unit"
            hint="留空 = 直接按基准单位比。填了别的单位，各行必须给出折算系数才能一起比。"
          >
            <Select
              id="ie-cmp-unit"
              value={compareUnitCode}
              disabled={!isAdmin}
              onChange={(e) => setCompareUnitCode(e.target.value)}
            >
              <option value="">（留空，按基准单位比）</option>
              {compareOptions.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u] ?? u}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="别名" htmlFor="ie-alias" hint="用逗号或顿号分隔。搜索时能命中，录价时不用打全名。">
            <Input
              id="ie-alias"
              value={aliases}
              disabled={!isAdmin}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="背景板、签到墙"
            />
          </Field>

          {itemType === 'personnel' ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={includesTravel}
                disabled={!isAdmin}
                onChange={(e) => setIncludesTravel(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
              报价含差旅
            </label>
          ) : null}

          {detail.isActive === false ? (
            <Note tone="warn">
              这个主体已作废。左下角「恢复这个主体」能把它拿回来，价都还在。
            </Note>
          ) : null}

          <label className="switch">
            <input
              type="checkbox"
              checked={isActive}
              disabled={!isAdmin}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            启用（停用后不出现在列表，历史报价单照常显示）
          </label>

          {error ? <div className="field-error">{error}</div> : null}
        </div>
      )}
    </Drawer>
  );
}
