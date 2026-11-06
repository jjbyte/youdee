'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { addDaysISO, rateToPctInput, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { PROJECT_TYPE_LABELS, PROJECT_TYPE_ORDER } from '@/lib/labels';
import type { ProjectType, QuoteTemplate } from '@/lib/types';
import { IconPlus } from '@/components/icons';

/**
 * 新建报价单（草稿）。
 * 客户名/活动名/有效期三项必填由服务端校验，这里只做同款提示，不静默填默认值。
 *
 * 项目类型 → 毛利率：选类型就把该类型配好的默认毛利率填进来，当场可见可改。
 * 之前类型只影响预警线的颜色，毛利率永远是空的，客户以为是"选了类型没反应"。
 *
 * **没选类型时也要有值**：下拉上写着「未选（按默认 25%）」，那就真的按 25% 填进去。
 * 空着建单会让第一行加进来就报「这张单没有目标毛利率，无法反推」。
 *
 * 有效期与模板两个初值都来自服务端设置，不写死：
 *   - 有效期 = 今天 + 设置里的「报价有效期天数」（改设置只影响之后新建的单）
 *   - 模板 = 默认模板；抬头印的供应商名称在建单这一刻快照进单据，之后改模板不影响这张单
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
  const [marginRate, setMarginRate] = useState('');
  const [defaultMargin, setDefaultMargin] = useState('');
  const [typeMargins, setTypeMargins] = useState<Record<string, string>>({});
  const [validUntil, setValidUntil] = useState(addDaysISO(todayISO(), 30));
  const [validDays, setValidDays] = useState(30);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 类型 → 默认毛利率的对照表 + 全站默认利率。拿不到就退化成"不预填"，不报错：建单不能被它拦住
  useEffect(() => {
    api
      .quoteSettings()
      .then((s) => {
        const map: Record<string, string> = {};
        for (const t of s.marginThresholds ?? []) {
          if (t.defaultMarginRate) map[t.projectType] = rateToPctInput(t.defaultMarginRate);
        }
        setTypeMargins(map);
        const fallback = rateToPctInput(s.defaultMarginThreshold);
        setDefaultMargin(fallback);
        // 只在用户还没动手时预填：接口回来前就敲了数字，不能被异步结果盖掉
        setMarginRate((prev) => (prev.trim() === '' ? fallback : prev));
        // 有效期同理：用户已经改过日期就不动它
        const days = Number(s.validDays);
        if (Number.isFinite(days) && days > 0) {
          setValidDays(days);
          const next = addDaysISO(todayISO(), days);
          setValidUntil((prev) => (prev === addDaysISO(todayISO(), 30) ? next : prev));
        }
      })
      .catch(() => setTypeMargins({}));
  }, []);

  // 模板：任何登录用户都能读（成员也要建单）；失败就不选模板，服务端会落到默认模板
  useEffect(() => {
    api
      .quoteTemplates({ activeOnly: true })
      .then((r) => {
        const list = r.items ?? [];
        setTemplates(list);
        setTemplateId((prev) => prev || (list.find((t) => t.isDefault) ?? list[0])?.id || '');
      })
      .catch(() => setTemplates([]));
  }, []);

  function pickType(t: '' | ProjectType) {
    setProjectType(t);
    // 类型有专门配的就用它的；没有（含"未选"）回到全站默认，不留空
    const next = (t && typeMargins[t]) || defaultMargin;
    if (next) setMarginRate(next);
  }

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
    const rate = marginRate.trim() === '' ? null : Number(marginRate);
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0 || rate >= 100)) {
      setError('毛利率要填 0 到 100 之间的数；不确定就先留空，进单后再填。');
      return;
    }
    setBusy(true);
    try {
      const quote = await api.createQuote({
        customerName: customerName.trim(),
        eventName: eventName.trim(),
        eventDate: eventDate || null,
        projectType: projectType || null,
        targetMarginRate: rate === null ? null : String(rate / 100),
        validUntil,
        templateId: templateId || null,
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
            <Field label="报价有效期" htmlFor="q-valid" required hint={`按设置里的 ${validDays} 天预填，可以改。`}>
              <Input
                id="q-valid"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <Field
              label="项目类型"
              htmlFor="q-type"
              hint="决定预警线，也带出这一类的默认毛利率。"
            >
              <Select
                id="q-type"
                value={projectType}
                onChange={(e) => pickType(e.target.value as ProjectType | '')}
              >
                <option value="">未选（按默认 {defaultMargin || '25'}%）</option>
                {PROJECT_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {PROJECT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="毛利率"
              htmlFor="q-margin"
              hint={
                projectType && typeMargins[projectType]
                  ? `按「${PROJECT_TYPE_LABELS[projectType]}」的默认值填好，可以改。`
                  : projectType
                    ? `这个类型没配默认毛利率，先按全站默认 ${defaultMargin || '25'}% 填好，可以改。`
                    : `未选类型时按全站默认 ${defaultMargin || '25'}% 填好，可以改。`
              }
            >
              <div className="flex items-center gap-[var(--space-2)]">
                <Input
                  id="q-margin"
                  className="num"
                  inputMode="decimal"
                  value={marginRate}
                  onChange={(e) => setMarginRate(e.target.value)}
                  placeholder="40"
                />
                <span className="t-xs t-3">%</span>
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <Field
              label="报价单模板"
              htmlFor="q-template"
              hint={
                templates.length === 0
                  ? '还没有可用模板，抬头「供应商名称」会印成「—」。'
                  : '决定客户版抬头印的供应商名称；建好后不受模板改动影响。'
              }
            >
              <Select id="q-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.length === 0 ? <option value="">（没有可用模板）</option> : null}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.supplierName ? `（${t.supplierName}）` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
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
