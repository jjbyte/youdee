'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { addDaysISO, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { PROJECT_TYPE_LABELS, PROJECT_TYPE_ORDER } from '@/lib/labels';
import type { ProjectType } from '@/lib/types';
import { IconPlus } from '@/components/icons';

/**
 * 新建报价单（草稿）。
 * 客户名/活动名/有效期三项必填由服务端校验，这里只做同款提示，不静默填默认值。
 */
export function NewQuoteButton({
  label = '新建报价单',
  variant = 'primary',
  size = 'md',
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [projectType, setProjectType] = useState<'' | ProjectType>('');
  const [validUntil, setValidUntil] = useState(addDaysISO(todayISO(), 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!customerName.trim()) {
      setError('客户名称为空，客户版无法发出。');
      return;
    }
    if (!eventName.trim()) {
      setError('活动名称为空，先写一个活动名。');
      return;
    }
    setBusy(true);
    try {
      const quote = await api.createQuote({
        customerName: customerName.trim(),
        eventName: eventName.trim(),
        eventDate: eventDate || null,
        projectType: projectType || null,
        validUntil,
      });
      setOpen(false);
      router.push(`/quotes/${quote.id}/edit`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} icon={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建报价单"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              先不建
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              建个草稿
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="客户" htmlFor="q-customer" required>
            <Input
              id="q-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="星海科技"
              autoFocus
            />
          </Field>
          <Field label="活动名称" htmlFor="q-event" required>
            <Input
              id="q-event"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="2026 年会《向新而行》"
            />
          </Field>
          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <Field label="活动日期" htmlFor="q-date">
              <Input id="q-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </Field>
            <Field label="报价有效期" htmlFor="q-valid" required>
              <Input
                id="q-valid"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="项目类型"
            htmlFor="q-type"
            hint="只影响毛利预警线的取值，不拦截出单。"
          >
            <Select
              id="q-type"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value as ProjectType | '')}
            >
              <option value="">未选（按默认 25%）</option>
              {PROJECT_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {PROJECT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {error ? (
            <div className="field-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
