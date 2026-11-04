/**
 * 单位字典（只读）。
 *
 * 不提供写入接口：单位表决定 unit_mode 与比价基准，改动它会牵动 EXCLUDE 唯一键，
 * 属于迁移级操作，不该由页面上的一个按钮触发。
 */
import { q } from '../db';

// ── 单位 ────────────────────────────────────────────────────

export async function listUnits() {
  const rows = await q<{ code: string; name_zh: string; kind: string; is_time: boolean; sort_order: number; note: string | null }>(
    'SELECT code, name_zh, kind, is_time, sort_order, note FROM units ORDER BY sort_order',
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name_zh,
    kind: r.kind,
    is_time: r.is_time,
    sort_order: r.sort_order,
    note: r.note,
  }));
}
