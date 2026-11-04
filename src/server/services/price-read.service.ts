/**
 * 价格读取：列表、详情、即将失效/软陈旧提醒、变更审计。
 *
 * 「即将失效」与「长期未核价」是两个不同的维护动作，所以分成两个 mode：
 *   expiring → 硬失效在即（再不续价就没有价了）
 *   stale    → 软陈旧（价还能用，但可能不准了）
 * 混在一起会让人分不清"我现在必须做什么"和"我最好做什么"。
 */
import { AppError } from '../http';
import { one, q, today } from '../db';
import { derivePriceState } from '@/domain/price-resolve';
import {
  PRICE_SELECT,
  getPriceRow,
  listPrices,
  tiersByPriceIds,
  toPriceDTO,
  type PriceDTO,
} from '../store/prices.store';
import { marginWarnRate, staleDaysThreshold } from '../store/settings.store';
import { pageQuery, paginated, type PageQuery } from '../params';

export interface PriceListQuery {
  itemId: string | null;
  supplierId: string | null;
  status: string | null;
  from: string | null;
  to: string | null;
  page: PageQuery;
}

export async function listPriceDtos(query: PriceListQuery) {
  const { rows, total } = await listPrices({
    itemId: query.itemId,
    supplierId: query.supplierId,
    status: query.status,
    from: query.from,
    to: query.to,
    limit: query.page.limit,
    offset: query.page.offset,
  });
  const threshold = await staleDaysThreshold();
  const todayStr = today();
  const tiers = await tiersByPriceIds(rows.map((r) => r.id));
  const items = rows.map((r) => toPriceDTO(r, tiers.get(r.id) ?? [], threshold, todayStr));
  return paginated(items, total, query.page);
}

export async function getPriceDetail(id: string): Promise<PriceDTO> {
  const row = await getPriceRow(id);
  if (!row) throw new AppError(40401, '这条价格不存在。', 404);
  const tiers = await tiersByPriceIds([id]);
  const attachments = await q<{
    id: string;
    kind: string;
    storage_key: string;
    url: string;
    original_name: string | null;
    mime: string | null;
    size_bytes: number | null;
    label: string | null;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT id, kind, storage_key, url, original_name, mime, size_bytes, label, note, created_at
       FROM price_attachments WHERE price_id = $1 ORDER BY created_at`,
    [id],
  );
  return {
    ...toPriceDTO(row, tiers.get(id) ?? [], await staleDaysThreshold(), today()),
    attachments: attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      storage_key: a.storage_key,
      thumb_key: null,
      url: a.url,
      thumb_url: null,
      original_name: a.original_name ?? '',
      mime: a.mime ?? '',
      size_bytes: a.size_bytes ?? 0,
      width: null,
      height: null,
      sort_order: 0,
      note: a.note,
      label: a.label,
      created_at: a.created_at.toISOString(),
    })),
  };
}

export interface ExpiringPriceDTO {
  price_id: string;
  item_id: string;
  item_type: string;
  item_name: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  effective_to: string | null;
  days_left: number | null;
  last_effective_at: string;
  staleness_days: number;
}

/** days 与 mode 的语义不同：expiring 是"还有几天失效"，stale 是"多久没核价算陈旧" */
export async function listExpiring(mode: 'expiring' | 'stale', days: number): Promise<ExpiringPriceDTO[]> {
  const todayStr = today();
  if (mode === 'stale') {
    const rows = await q<{
      price_id: string;
      item_id: string;
      item_type: string;
      item_name: string;
      supplier_id: string;
      supplier_name: string;
      supplier_type: string;
      effective_to: string | null;
      last_effective_at: Date;
      staleness_days: number;
    }>(
      `SELECT p.id AS price_id, p.item_id, i.item_type, i.name AS item_name,
              p.supplier_id, s.name AS supplier_name, s.type AS supplier_type,
              p.effective_to,
              GREATEST(p.updated_at, COALESCE(p.last_used_at, p.updated_at)) AS last_effective_at,
              ($1::date - GREATEST(p.updated_at, COALESCE(p.last_used_at, p.updated_at))::date) AS staleness_days
         FROM prices p
         JOIN items i ON i.id = p.item_id
         JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
        WHERE p.status = 'active'
          AND (p.effective_to IS NULL OR p.effective_to >= $1::date)
          AND ($1::date - GREATEST(p.updated_at, COALESCE(p.last_used_at, p.updated_at))::date) >= $2
        ORDER BY staleness_days DESC, i.name
        LIMIT 200`,
      [todayStr, days],
    );
    return rows.map((r) => ({
      price_id: r.price_id,
      item_id: r.item_id,
      item_type: r.item_type,
      item_name: r.item_name,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      supplier_type: r.supplier_type,
      effective_to: r.effective_to,
      days_left: null,
      last_effective_at: r.last_effective_at.toISOString(),
      staleness_days: r.staleness_days,
    }));
  }

  const rows = await q<{
    price_id: string;
    item_id: string;
    item_type: string;
    item_name: string;
    supplier_id: string;
    supplier_name: string;
    supplier_type: string;
    effective_to: string;
    days_left: number;
    last_effective_at: Date;
    staleness_days: number;
  }>(
    `SELECT p.id AS price_id, p.item_id, i.item_type, i.name AS item_name,
            p.supplier_id, s.name AS supplier_name, s.type AS supplier_type,
            p.effective_to,
            (p.effective_to - $1::date) AS days_left,
            GREATEST(p.updated_at, COALESCE(p.last_used_at, p.updated_at)) AS last_effective_at,
            ($1::date - GREATEST(p.updated_at, COALESCE(p.last_used_at, p.updated_at))::date) AS staleness_days
       FROM prices p
       JOIN items i ON i.id = p.item_id
       JOIN suppliers s ON s.id = p.supplier_id AND s.is_active
      WHERE p.status = 'active'
        AND p.effective_to IS NOT NULL
        AND p.effective_to >= $1::date
        AND p.effective_to <= ($1::date + ($2::int)::text || ' days')::interval
      ORDER BY p.effective_to, i.name
      LIMIT 200`,
    [todayStr, days],
  );
  return rows.map((r) => ({
    price_id: r.price_id,
    item_id: r.item_id,
    item_type: r.item_type,
    item_name: r.item_name,
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_name,
    supplier_type: r.supplier_type,
    effective_to: r.effective_to,
    days_left: r.days_left,
    last_effective_at: r.last_effective_at.toISOString(),
    staleness_days: r.staleness_days,
  }));
}

export interface PriceLogDTO {
  action: string;
  changed_at: string;
  changed_by_name: string | null;
  snapshot: unknown;
  prev_snapshot: unknown;
  note: string | null;
}

export async function priceHistory(id: string): Promise<PriceLogDTO[]> {
  const exists = await one<{ id: string }>('SELECT id FROM prices WHERE id = $1', [id]);
  if (!exists) throw new AppError(40401, '这条价格不存在。', 404);
  const rows = await q<{
    action: string;
    changed_at: Date;
    changed_by_name: string | null;
    snapshot: unknown;
    prev_snapshot: unknown;
    note: string | null;
  }>(
    `SELECT l.action, l.changed_at, u.name AS changed_by_name, l.snapshot, l.prev_snapshot, l.note
       FROM price_change_logs l
       LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.price_id = $1
      ORDER BY l.changed_at DESC, l.id DESC`,
    [id],
  );
  return rows.map((r) => ({
    action: r.action,
    changed_at: r.changed_at.toISOString(),
    changed_by_name: r.changed_by_name,
    snapshot: r.snapshot,
    prev_snapshot: r.prev_snapshot,
    note: r.note,
  }));
}

export interface EffectiveStateInfo {
  state: string;
  stalenessDays: number;
}

/** 给「报价行」用的轻量状态：出单时要说清"这行价已经过期了" */
export async function priceEffectiveState(id: string): Promise<EffectiveStateInfo | null> {
  const row = await getPriceRow(id);
  if (!row) return null;
  const s = derivePriceState({
    status: row.status as 'active' | 'superseded' | 'archived',
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    onDate: today(),
    staleDaysThreshold: await staleDaysThreshold(),
  });
  return { state: s.state, stalenessDays: s.stalenessDays };
}

/** 详情页/列表页都要的「本单生效预警线」，集中一处避免两处不一致 */
export async function warnRateFor(projectType: string | null) {
  return marginWarnRate(projectType);
}

export { pageQuery, PRICE_SELECT };
