/**
 * 系统设置（app_settings：key → jsonb）。
 *
 * 为什么带 5 秒进程内缓存：软陈旧阈值、默认税口径在「列表 / 比价 / 取价 / 自检」
 * 每次请求都要读，为一张小表多打一次库不值得。缓存只是加速，真源仍是库，
 * 过期即失效，所以"改了设置别处看不到"最多持续 5 秒而不是永久。
 */
import { q } from '../db';

const TTL_MS = 5_000;
let cache: { at: number; map: Record<string, unknown> } | null = null;

export async function loadSettings(force = false): Promise<Record<string, unknown>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const rows = await q<{ key: string; value: unknown }>('SELECT key, value FROM app_settings');
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value;
  cache = { at: Date.now(), map };
  return map;
}

export function invalidateSettings(): void {
  cache = null;
}

export async function setSetting(key: string, value: unknown, userId: string | null): Promise<void> {
  await q(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
  invalidateSettings();
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const map = await loadSettings();
  const v = map[key];
  return v === undefined || v === null ? fallback : (v as T);
}

export async function staleDaysThreshold(): Promise<number> {
  const n = Number(await getSetting<number>('stale_days_threshold', 90));
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export type TaxBasis = 'inclusive' | 'exclusive';

export async function defaultTaxBasis(): Promise<TaxBasis> {
  return (await getSetting<string>('tax_statement_default', 'inclusive')) === 'exclusive'
    ? 'exclusive'
    : 'inclusive';
}

export async function quoteNoPrefix(): Promise<string> {
  return await getSetting<string>('quote_no_prefix', 'YD');
}

export async function validDaysDefault(): Promise<number> {
  const n = Number(await getSetting<number>('quote_valid_days_default', 15));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 15;
}

export interface MarginThresholdRow {
  project_type: string;
  warn_rate: string;
  label: string;
  sort_order: number;
}

export async function marginThresholds(): Promise<MarginThresholdRow[]> {
  return q<MarginThresholdRow>(
    'SELECT project_type, warn_rate, label, sort_order FROM margin_thresholds ORDER BY sort_order',
  );
}

export interface MarginWarn {
  rate: number;
  source: 'project_type' | 'global_default';
}

/**
 * 毛利预警线三级链（架构 §9.6 R1）：
 *   ① project_type 命中 margin_thresholds → 用它
 *   ② 无项目类型 / 表里没这行 → app_settings 全局默认
 *   ③ 全局默认也缺 → 代码常量 0.25 并打一条配置缺失日志
 * 第 ③ 层是唯一允许的硬编码：不兜这一层，自检会 500，
 * 而"功能不可用"比"用了默认值"严重得多。
 */
export async function marginWarnRate(projectType: string | null): Promise<MarginWarn> {
  if (projectType) {
    const row = await q<{ warn_rate: string }>(
      'SELECT warn_rate FROM margin_thresholds WHERE project_type = $1',
      [projectType],
    );
    const first = row[0];
    if (first) {
      const rate = Number(first.warn_rate);
      if (Number.isFinite(rate)) return { rate, source: 'project_type' };
    }
  }
  const raw = await getSetting<number | string | null>('default_margin_threshold', null);
  const fallbackRaw = raw ?? (await getSetting<number | string | null>('default_margin_warn_rate', null));
  const rate = Number(fallbackRaw);
  if (fallbackRaw !== null && Number.isFinite(rate) && rate > 0 && rate < 1) {
    return { rate, source: 'global_default' };
  }
  console.warn('[settings] default_margin_threshold 缺失或非法，回退常量 0.25');
  return { rate: 0.25, source: 'global_default' };
}
