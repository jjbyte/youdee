import { body, ok, optStr, requireAdmin, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { getQuoteSettings, patchQuoteSettings } from '@/server/services/settings.service';
import type { QuoteSettingsPatch } from '@/server/services/settings.service';

export const GET = route(async () => {
  await requireUser();
  return ok(await getQuoteSettings());
});

/**
 * 阈值整数组覆盖，不做增量合并：少传一个就被默认值悄悄改回去，
 * 是配置类接口最常见也最难查的一类事故。
 */
export const PATCH = route(async (req) => {
  const actor = await requireAdmin('修改报价阈值');
  const b = await body<Record<string, unknown>>(req);
  const thresholds = Array.isArray(b.margin_thresholds)
    ? (b.margin_thresholds as Array<Record<string, unknown>>).map((t) => ({
        project_type: String(t.project_type ?? ''),
        label: optStr(t.label, 30) ?? undefined,
        warn_rate: String(t.warn_rate ?? ''),
      }))
    : undefined;
  const updated = await patchQuoteSettings(
    {
      stale_days_threshold: b.stale_days_threshold === undefined ? undefined : Number(b.stale_days_threshold),
      default_margin_threshold: b.default_margin_threshold === undefined
        ? undefined
        : String(b.default_margin_threshold),
      tax_statement_default: (b.tax_statement_default === 'inclusive' || b.tax_statement_default === 'exclusive')
        ? b.tax_statement_default
        : undefined,
      default_terms: b.default_terms === undefined ? undefined : optStr(b.default_terms, 2000),
      margin_thresholds: thresholds,
    } satisfies QuoteSettingsPatch,
    actor,
  );
  return ok(updated);
});
