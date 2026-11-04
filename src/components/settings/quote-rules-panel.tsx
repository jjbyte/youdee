'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { PROJECT_TYPE_LABELS, PROJECT_TYPE_ORDER } from '@/lib/labels';
import type { QuoteSettings, TaxBasis } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Note, InlineLoading, ErrorState } from '@/components/ui/states';
import { Segmented } from '@/components/ui/segmented';
import { IconRisk } from '@/components/icons';

const HINTS = {
  margin: '只影响提示与自检清单，绝不阻断、不禁用出单。',
  stale: '改小 → 提示变多；改大 → 提示变少。恰好在阈值当天算有效。',
  defaultMargin: '只影响新加的行，不改历史单。',
  tax: '这不是文案项，是取价项：新建单会按它取成本。已建好的单不受影响。',
  validDays: '客户版页脚和列表页的「将过期」都用这个数。',
};

/**
 * 比价与计价规则（§C.9）。**6 个可配项，全部不许硬编码。**
 *
 * 第 5 项（默认含税口径）是取价开关不是文案开关：它决定 resolvePrice(tax_basis) 取哪一条价，
 * 切换时整单成本与合计都会变。所以这里写清楚的不是"改了一句声明"，而是"改的是取价"。
 *
 * 它只影响**新建**的单——quotes.tax_statement 是单据属性，设置页的值只是建单时的初值。
 */
export function QuoteRulesPanel() {
  const [settings, setSettings] = useState<QuoteSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [defaultMargin, setDefaultMargin] = useState('');
  const [thresholds, setThresholds] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .quoteSettings()
      .then((s) => {
        setSettings(s);
        setDefaultMargin(s.defaultMarginThreshold ? String(Number(s.defaultMarginThreshold) * 100) : '25');
        const map: Record<string, string> = {};
        for (const t of s.marginThresholds ?? []) {
          map[t.projectType] = t.warnRate ? String(Number(t.warnRate) * 100) : '';
        }
        setThresholds(map);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateQuoteSettings({
        ...settings,
        defaultMarginThreshold: String(Number(defaultMargin || '25') / 100),
        marginThresholds: PROJECT_TYPE_ORDER.filter((t) => thresholds[t]).map((t) => ({
          projectType: t,
          warnRate: String(Number(thresholds[t]) / 100),
        })),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <ErrorState message={error} />;
  if (!settings) return <InlineLoading label="正在读设置…" />;

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="panel">
        <div className="fw-semi t-sm">毛利率预警阈值</div>
        <p className="t-2xs t-3 mb-[var(--space-3)]">{HINTS.margin}</p>

        <div className="flex flex-col gap-[var(--space-3)]">
          <label className="flex items-center gap-[var(--space-3)]">
            <span className="t-sm" style={{ width: 120 }}>
              默认
            </span>
            <Input
              className="num"
              style={{ width: 80, textAlign: 'right' }}
              inputMode="decimal"
              value={defaultMargin}
              onChange={(e) => setDefaultMargin(e.target.value)}
              aria-label="默认毛利率阈值（百分比）"
            />
            <span className="t-xs t-3">%</span>
          </label>

          {PROJECT_TYPE_ORDER.map((t) => (
            <label key={t} className="flex items-center gap-[var(--space-3)]">
              <span className="t-sm" style={{ width: 120 }}>
                {PROJECT_TYPE_LABELS[t]}
              </span>
              <Input
                className="num"
                style={{ width: 80, textAlign: 'right' }}
                inputMode="decimal"
                value={thresholds[t] ?? ''}
                placeholder="—"
                aria-label={`${PROJECT_TYPE_LABELS[t]} 的毛利率阈值（百分比）`}
                onChange={(e) => setThresholds((m) => ({ ...m, [t]: e.target.value }))}
              />
              <span className="t-xs t-3">%</span>
            </label>
          ))}
        </div>
        <p className="t-2xs t-3 mt-[var(--space-3)]">
          留空 = 用默认的值。不做「必须全填」——逼管理员给 5 个类型都编一个数，他会全部填成默认值，等于没分。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-[var(--space-5)]">
        <div className="panel">
          <Field label="价格陈旧阈值（软陈旧）" htmlFor="stale-days" hint={HINTS.stale}>
            <div className="flex items-center gap-[var(--space-2)]">
              <Input
                id="stale-days"
                className="num"
                style={{ width: 88, textAlign: 'right' }}
                inputMode="numeric"
                value={String(settings.staleDaysThreshold)}
                onChange={(e) => setSettings({ ...settings, staleDaysThreshold: Number(e.target.value) || 0 })}
              />
              <span className="t-xs t-3">天</span>
            </div>
          </Field>
        </div>

        <div className="panel">
          <Field label="默认毛利率（新行初值）" htmlFor="default-margin" hint={HINTS.defaultMargin}>
            <Select
              id="default-margin"
              value={settings.defaultMarginThreshold}
              onChange={(e) => setSettings({ ...settings, defaultMarginThreshold: e.target.value })}
            >
              <option value="0.25">25%</option>
              <option value="0.3">30%</option>
              <option value="0.35">35%</option>
              <option value="0.4">40%</option>
              <option value="0.45">45%</option>
              <option value="0.5">50%</option>
            </Select>
          </Field>
        </div>
      </div>

      <div className="panel">
        <Field label="默认含税口径" hint={HINTS.tax}>
          <Segmented<TaxBasis>
            ariaLabel="默认含税口径"
            value={settings.taxStatementDefault}
            options={[
              { value: 'inclusive', label: '含税' },
              { value: 'exclusive', label: '不含税' },
            ]}
            onChange={(v) => setSettings({ ...settings, taxStatementDefault: v })}
          />
        </Field>
        <Note tone="warn" className="mt-[var(--space-3)]">
          <span className="inline-flex items-center gap-[var(--space-2)]">
            <IconRisk size={16} />
            它只影响「新建」的单。已经建好的单按自己存的口径取价，不会因为这里改了而变。
          </span>
        </Note>
      </div>

      <div className="panel">
        <Field label="报价有效期天数" htmlFor="valid-days" hint={HINTS.validDays}>
          <div className="flex items-center gap-[var(--space-2)]">
            <Input
              id="valid-days"
              className="num"
              style={{ width: 88, textAlign: 'right' }}
              inputMode="numeric"
              value="30"
              readOnly
              aria-label="报价有效期天数"
            />
            <span className="t-xs t-3">天</span>
          </div>
        </Field>
        <p className="t-2xs t-3 mt-[var(--space-2)]">
          这一项接口还没有对应字段，先只读展示默认 30 天；新单的 valid_until 由建单时按 30 天算。
        </p>
      </div>

      {error ? <Note tone="danger">{error}</Note> : null}

      <div className="flex items-center gap-[var(--space-3)]">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          保存这些规则
        </Button>
        {saved ? <span className="t-xs t-success">存好了。新单会按新规则走，老单不受影响。</span> : null}
      </div>
    </div>
  );
}
