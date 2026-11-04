'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { Category, ItemType } from '@/lib/types';
import { UNIT_LABELS } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { IconPlus } from '@/components/icons';

/** 新建主体（物料 / 人员）。基准单位一旦有价格记录就不能改，所以建的时候要说清。 */
export function NewItemButton({
  itemType,
  label,
  variant = 'primary',
}: {
  itemType: ItemType;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [spec, setSpec] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitCode, setUnitCode] = useState(itemType === 'personnel' ? 'session' : 'sqm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .categories(itemType)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res[itemType] ?? []);
        setCategories(list);
        setCategoryId(list[0]?.id ?? '');
      })
      .catch(() => setCategories([]));
  }, [open, itemType]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('名字还没填。');
      return;
    }
    if (!categoryId) {
      setError('先选个分类。');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createItem({
        itemType,
        categoryId,
        name: name.trim(),
        spec: spec.trim() || null,
        baseUnitCode: unitCode,
      });
      setOpen(false);
      if (created?.id) router.push(itemType === 'material' ? `/materials/${created.id}` : `/staff/${created.id}`);
      else router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const unitOptions =
    itemType === 'personnel'
      ? ['session', 'day', 'person_day', 'hour', 'half_day']
      : ['sqm', 'piece', 'block', 'sheet', 'set', 'group', 'root', 'roll', 'meter', 'linear_m', 'day', 'batch'];

  return (
    <>
      <Button variant={variant} icon={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={itemType === 'material' ? '新建物料' : '新建人员'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              先不建
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              建好
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="名称" htmlFor="ni-name" required>
            <Input
              id="ni-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={itemType === 'material' ? '桁架 3m 方管' : '张启明（主持人）'}
            />
          </Field>
          <Field label="规格 / 说明" htmlFor="ni-spec" hint={itemType === 'personnel' ? '例：单场 4 小时，超时另计' : '例：3000×3000'}>
            <Input id="ni-spec" value={spec} onChange={(e) => setSpec(e.target.value)} />
          </Field>
          <Field label="分类" htmlFor="ni-cat" required>
            <Select id="ni-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.length === 0 ? <option value="">还没有分类，让管理员先在设置里建</option> : null}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={itemType === 'personnel' ? '计价方式' : '基准单位'}
            htmlFor="ni-unit"
            required
            hint="建好之后有了价格记录，这个就不能改了。"
          >
            <Select id="ni-unit" value={unitCode} onChange={(e) => setUnitCode(e.target.value)}>
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {itemType === 'personnel'
                    ? { session: '按场', day: '按天', person_day: '按人天', hour: '按小时', half_day: '按半天' }[u]
                    : (UNIT_LABELS[u] ?? u)}
                </option>
              ))}
            </Select>
          </Field>
          {error ? <div className="field-error">{error}</div> : null}
        </div>
      </Modal>
    </>
  );
}
