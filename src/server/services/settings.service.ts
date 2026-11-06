/**
 * 系统设置：公司抬头 / 报价阈值。
 *
 * 阈值一律可配：把 0.25 写进代码，等于把"老板心里的数"固化成程序员猜的数，
 * 而毛利预警线恰恰是每个公司都不一样、每季度还可能调的一个数。
 */
import { q } from '../db';
import { AppError } from '../http';
import type { CurrentUser } from '../auth/session';
import {
  defaultTaxBasis,
  getSetting,
  loadSettings,
  marginThresholds,
  setSetting,
  staleDaysThreshold,
  validDaysDefault,
} from '../store/settings.store';

export interface CompanyProfile {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_no: string | null;
  bank_info: string | null;
  logo_url: string | null;
}

const COMPANY_KEY = 'company_profile';

export async function getCompany(): Promise<CompanyProfile> {
  const map = await loadSettings();
  const raw = (map[COMPANY_KEY] ?? {}) as Partial<CompanyProfile>;
  return {
    name: raw.name ?? String(map['org_name'] ?? ''),
    address: raw.address ?? null,
    phone: raw.phone ?? null,
    email: raw.email ?? null,
    tax_no: raw.tax_no ?? null,
    bank_info: raw.bank_info ?? null,
    logo_url: raw.logo_url ?? null,
  };
}

export async function patchCompany(input: Partial<CompanyProfile>, actor: CurrentUser): Promise<CompanyProfile> {
  const current = await getCompany();
  const next: CompanyProfile = {
    name: input.name ?? current.name,
    address: input.address !== undefined ? input.address : current.address,
    phone: input.phone !== undefined ? input.phone : current.phone,
    email: input.email !== undefined ? input.email : current.email,
    tax_no: input.tax_no !== undefined ? input.tax_no : current.tax_no,
    bank_info: input.bank_info !== undefined ? input.bank_info : current.bank_info,
    logo_url: input.logo_url !== undefined ? input.logo_url : current.logo_url,
  };
  if (next.name.length > 100) {
    throw new AppError(40001, '公司名称最多 100 个字符。', 400, { field: 'name' });
  }
  await setSetting(COMPANY_KEY, next, actor.id);
  return next;
}

export interface QuoteSettingsDTO {
  stale_days_threshold: number;
  default_margin_threshold: string;
  margin_thresholds: Array<{
    project_type: string;
    label: string;
    warn_rate: string;
    default_margin_rate: string | null;
  }>;
  tax_statement_default: 'inclusive' | 'exclusive';
  default_terms: string | null;
  /** 新建单的报价有效期天数；已建好的单存着自己的 valid_until，不会被这项改动影响 */
  valid_days: number;
}

/**
 * 写入用的形状与读出不完全对称，所以单列一个类型而不是复用 Partial<DTO>：
 * - margin_thresholds[].label 可省略（新增一行时先只给类型和预警线，标签回落到 project_type）
 * - 读出来的 label 永远有值，写进去时可以没有
 * - default_margin_rate 用 null 表示「这个类型不设默认毛利率」，与「没传 = 不改」区分开
 */
export interface QuoteSettingsPatch {
  stale_days_threshold?: number;
  default_margin_threshold?: string;
  margin_thresholds?: Array<{
    project_type: string;
    label?: string | null;
    warn_rate: string;
    default_margin_rate?: string | null;
  }>;
  tax_statement_default?: 'inclusive' | 'exclusive';
  default_terms?: string | null;
  valid_days?: number;
}

export async function getQuoteSettings(): Promise<QuoteSettingsDTO> {
  const staleDays = await staleDaysThreshold();
  const rows = await marginThresholds();
  const fallback = await getSetting<number | string | null>('default_margin_threshold', null);
  const legacy = await getSetting<number | string | null>('default_margin_warn_rate', 0.25);
  const margin = Number(fallback ?? legacy);
  return {
    stale_days_threshold: staleDays,
    default_margin_threshold: Number.isFinite(margin) ? margin.toFixed(4) : '0.2500',
    margin_thresholds: rows.map((r) => ({
      project_type: r.project_type,
      label: r.label,
      warn_rate: Number(r.warn_rate).toFixed(4),
      default_margin_rate:
        r.default_margin_rate === null || r.default_margin_rate === undefined
          ? null
          : Number(r.default_margin_rate).toFixed(4),
    })),
    tax_statement_default: await defaultTaxBasis(),
    default_terms: await getSetting<string | null>('default_terms', null),
    valid_days: await validDaysDefault(),
  };
}

export async function patchQuoteSettings(
  input: QuoteSettingsPatch,
  actor: CurrentUser,
): Promise<QuoteSettingsDTO> {
  if (input.stale_days_threshold !== undefined) {
    const n = Number(input.stale_days_threshold);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      throw new AppError(40001, '软陈旧阈值必须是 1~3650 之间的天数。', 400, { field: 'stale_days_threshold' });
    }
    await setSetting('stale_days_threshold', Math.trunc(n), actor.id);
  }
  if (input.default_margin_threshold !== undefined) {
    const v = Number(input.default_margin_threshold);
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      throw new AppError(40001, '默认毛利预警线必须是 0 到 1 之间的小数（如 0.25）。', 400, {
        field: 'default_margin_threshold',
      });
    }
    await setSetting('default_margin_threshold', v, actor.id);
    // 兼容旧键：只保留一个真源会让历史读法读到过期值
    await setSetting('default_margin_warn_rate', v, actor.id);
  }
  if (input.tax_statement_default !== undefined) {
    if (input.tax_statement_default !== 'inclusive' && input.tax_statement_default !== 'exclusive') {
      throw new AppError(40001, '税口径只能是 inclusive 或 exclusive。', 400, {
        field: 'tax_statement_default',
      });
    }
    await setSetting('tax_statement_default', input.tax_statement_default, actor.id);
  }
  if (input.default_terms !== undefined) {
    await setSetting('default_terms', input.default_terms, actor.id);
  }
  if (input.valid_days !== undefined) {
    const n = Number(input.valid_days);
    // 1~365：0 天等于"建单即过期"，大于一年则失去"报价有时效"的意义
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      throw new AppError(40001, '报价有效期必须是 1~365 之间的天数。', 400, { field: 'valid_days' });
    }
    await setSetting('quote_valid_days_default', Math.trunc(n), actor.id);
  }
  if (input.margin_thresholds !== undefined) {
    // 整数组覆盖：不做增量合并，避免"少传一个就被默认值悄悄改回去"
    for (const t of input.margin_thresholds) {
      const rate = Number(t.warn_rate);
      if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
        throw new AppError(40001, `项目类型 ${t.project_type} 的预警线必须在 0 到 1 之间。`, 400, {
          field: 'margin_thresholds',
        });
      }
      // 默认毛利率：undefined = 这次不动这一列；null / '' = 清空（这个类型不设默认）
      let margin: string | null | undefined;
      if (t.default_margin_rate === undefined) {
        margin = undefined;
      } else if (t.default_margin_rate === null || String(t.default_margin_rate).trim() === '') {
        margin = null;
      } else {
        const m = Number(t.default_margin_rate);
        if (!Number.isFinite(m) || m <= 0 || m >= 1) {
          throw new AppError(40001, `项目类型 ${t.project_type} 的默认毛利率必须在 0 到 1 之间。`, 400, {
            field: 'margin_thresholds',
          });
        }
        margin = String(m);
      }
      const updated = await q<{ project_type: string }>(
        margin === undefined
          ? `UPDATE margin_thresholds SET warn_rate=$2, updated_at=now() WHERE project_type=$1 RETURNING project_type`
          : `UPDATE margin_thresholds SET warn_rate=$2, default_margin_rate=$3, updated_at=now()
               WHERE project_type=$1 RETURNING project_type`,
        margin === undefined
          ? [t.project_type, t.warn_rate]
          : [t.project_type, t.warn_rate, margin],
      );
      if (updated.length === 0) {
        const label = t.label ?? t.project_type;
        const order = 100;
        await q(
          `INSERT INTO margin_thresholds (project_type, warn_rate, default_margin_rate, label, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [t.project_type, t.warn_rate, margin ?? null, label, order],
        );
      } else if (t.label) {
        await q('UPDATE margin_thresholds SET label=$2 WHERE project_type=$1', [t.project_type, t.label]);
      }
    }
  }
  return getQuoteSettings();
}
