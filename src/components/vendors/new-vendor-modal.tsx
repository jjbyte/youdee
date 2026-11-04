'use client';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { SUPPLIER_TYPE_LABELS, SUPPLIER_TYPE_ORDER } from '@/lib/labels';
import type { SupplierType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/** 新建供应商（§C.6）。录价抽屉里也能就地新建，这个入口给「先登记再去录价」的人。 */
export function NewVendorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'factory' as SupplierType,
    contactName: '',
    contactPhone: '',
    region: '',
    shopUrl: '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!form.name.trim()) {
      setError('供应商名不能空。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSupplier({
        name: form.name.trim(),
        type: form.type,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        region: form.region.trim() || null,
        shopUrl: form.shopUrl.trim() || null,
        note: form.note.trim() || null,
      });
      setForm({ name: '', type: 'factory', contactName: '', contactPhone: '', region: '', shopUrl: '', note: '' });
      await onCreated(created.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建供应商"
      width="560px"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            先不建
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            建好了
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <Field label="供应商名" htmlFor="vendor-name" required>
          <Input
            id="vendor-name"
            value={form.name}
            autoFocus
            placeholder="金桥桁架厂"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="类型" htmlFor="vendor-type" required hint="类型决定比价卡片上的徽章和「自有 / 外聘」的口径。">
          <Select
            id="vendor-type"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SupplierType }))}
          >
            {SUPPLIER_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {SUPPLIER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="联系人" htmlFor="vendor-contact">
            <Input
              id="vendor-contact"
              value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
            />
          </Field>
          <Field label="电话" htmlFor="vendor-phone">
            <Input
              id="vendor-phone"
              inputMode="tel"
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="备注" htmlFor="vendor-note" hint="记点以后用得上的：结算方式、账期、谁介绍的。">
          <Textarea
            id="vendor-note"
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}
