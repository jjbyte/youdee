/**
 * 计价主体（物料 + 人员统一表）的读路径。
 *
 * 列表不返回「裸最低价」：同一主体可能同时有租赁价与买断价、按天价与按场价，
 * 一个数字会被报价员记住并按错的单位报价。所以返回 lowest_summary 分组结构，
 * 并显式给出 is_multi_group 让前端决定渲不渲染数字。
 */
import { one, q, today } from '../db';
import { AppError } from '../http';
import { unitModeOf } from '@/domain/units';
import { defaultTaxBasis } from '../store/settings.store';
import { lowestSummaries, type LowestSummary } from './lowest-summary.service';

export const ITEM_SELECT = `
SELECT i.id, i.item_type, i.category_id, c.name AS category_name, i.name, i.spec, i.aliases,
       i.base_unit_code, bu.name_zh AS base_unit_name,
       i.compare_unit_code, cu.name_zh AS compare_unit_name,
       i.includes_travel, i.is_active, i.created_at, i.updated_at,
       (SELECT ii.url FROM item_images ii WHERE ii.item_id = i.id ORDER BY ii.sort_order, ii.created_at LIMIT 1) AS first_image_url,
       (SELECT count(DISTINCT p.supplier_id) FROM prices p WHERE p.item_id = i.id AND p.status = 'active')::int AS price_supplier_count
  FROM items i
  JOIN categories c ON c.id = i.category_id
  JOIN units bu ON bu.code = i.base_unit_code
  LEFT JOIN units cu ON cu.code = i.compare_unit_code`;

export interface ItemRow {
  id: string;
  item_type: string;
  category_id: string;
  category_name: string;
  name: string;
  spec: string | null;
  aliases: string[];
  base_unit_code: string;
  base_unit_name: string;
  compare_unit_code: string | null;
  compare_unit_name: string | null;
  includes_travel: boolean | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  first_image_url: string | null;
  price_supplier_count: number;
}

export function baseDto(r: ItemRow) {
  return {
    id: r.id,
    item_type: r.item_type,
    category_id: r.category_id,
    category_name: r.category_name,
    name: r.name,
    spec: r.spec,
    aliases: r.aliases,
    base_unit_code: r.base_unit_code,
    base_unit_name: r.base_unit_name,
    compare_unit_code: r.compare_unit_code,
    compare_unit_name: r.compare_unit_name,
    // 派生只读：物料恒为 null（物料也能按天租，所以只能看 item_type + 单位）
    pricing_mode: r.item_type === 'personnel' ? unitModeOf(r.base_unit_code) : null,
    includes_travel: r.includes_travel,
    is_active: r.is_active,
    first_image_url: r.first_image_url,
    price_supplier_count: r.price_supplier_count,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export interface ItemListQuery {
  itemType: string | null;
  q: string | null;
  categoryId: string | null;
  supplierId: string | null;
  isActive: boolean | null;
  orderBy: string;
  limit: number;
  offset: number;
}

export async function listItems(query: ItemListQuery) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, v: unknown) => {
    params.push(v);
    parts.push(clause(params.length));
  };
  if (query.itemType) add((n) => `i.item_type = $${n}`, query.itemType);
  if (query.isActive !== null) add((n) => `i.is_active = $${n}`, query.isActive);
  if (query.categoryId) {
    // 选中一级分类时把子分类的主体一起带出来，否则点"舞美硬体"看到空的
    add((n) => `(i.category_id = $${n}::uuid OR c.parent_id = $${n}::uuid)`, query.categoryId);
  }
  if (query.supplierId) {
    add(
      (n) => `EXISTS (SELECT 1 FROM prices p WHERE p.item_id = i.id AND p.supplier_id = $${n}::uuid AND p.status = 'active')`,
      query.supplierId,
    );
  }
  if (query.q) {
    add(
      (n) => `(i.name ILIKE $${n} OR i.spec ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(i.aliases) a WHERE a ILIKE $${n}))`,
      `%${query.q!.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
    );
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const total = await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM items i JOIN categories c ON c.id = i.category_id ${where}`,
    params,
  );
  const rows = await q<ItemRow>(
    `${ITEM_SELECT} ${where} ORDER BY ${query.orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.limit, query.offset],
  );
  const ids = rows.map((r) => r.id);
  const taxBasis = await defaultTaxBasis();
  const summaries = ids.length ? await lowestSummaries(ids, taxBasis === 'inclusive', today()) : new Map();

  const items = rows.map((r) => ({
    ...baseDto(r),
    lowest_summary: summaries.get(r.id) ?? { is_multi_group: false, groups: [] },
  }));
  return {
    items,
    total: Number(total[0]?.n ?? 0),
    page: Math.floor(query.offset / query.limit) + 1,
    limit: query.limit,
    hasMore: query.offset + rows.length < Number(total[0]?.n ?? 0),
  };
}

export async function searchLite(qText: string, itemType: string | null, limit: number) {
  const params: unknown[] = [`%${qText.replace(/[\\%_]/g, (m) => `\\${m}`)}%`];
  let extra = '';
  if (itemType) {
    params.push(itemType);
    extra = ` AND i.item_type = $${params.length}`;
  }
  params.push(limit);
  const rows = await q<{
    id: string;
    item_type: string;
    name: string;
    spec: string | null;
    base_unit_code: string;
    base_unit_name: string;
    first_image_url: string | null;
  }>(
    `SELECT i.id, i.item_type, i.name, i.spec, i.base_unit_code, bu.name_zh AS base_unit_name,
            (SELECT ii.url FROM item_images ii WHERE ii.item_id = i.id ORDER BY ii.sort_order LIMIT 1) AS first_image_url
       FROM items i JOIN units bu ON bu.code = i.base_unit_code
      WHERE i.is_active
        AND (i.name ILIKE $1 OR i.spec ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(i.aliases) a WHERE a ILIKE $1))
        ${extra}
      ORDER BY i.name
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function getItemDetail(id: string) {
  const rows = await q<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new AppError(40401, '这个计价主体不存在。', 404);

  const pathRows = await q<{ id: string; domain: string; name: string; parent_id: string | null; sort_order: number; default_pricing_nature: string | null }>(
    `SELECT id, domain, name, parent_id, sort_order, default_pricing_nature FROM categories
      WHERE id = $1 OR id = (SELECT parent_id FROM categories WHERE id = $1)`,
    [row.category_id],
  );
  const categoryPath = pathRows.sort((a, b) => (a.parent_id === null ? -1 : 1) - (b.parent_id === null ? -1 : 1));

  const images = await q<{
    id: string;
    storage_key: string;
    url: string;
    label: string | null;
    width: number | null;
    height: number | null;
    sort_order: number;
    created_at: Date;
  }>(
    `SELECT id, storage_key, url, label, width, height, sort_order, created_at
       FROM item_images WHERE item_id = $1 ORDER BY sort_order, created_at`,
    [id],
  );
  const links = await q<{ id: string; url: string; label: string | null; created_at: Date }>(
    'SELECT id, url, label, created_at FROM item_links WHERE item_id = $1 ORDER BY created_at',
    [id],
  );
  const taxBasis = await defaultTaxBasis();
  const summaries = await lowestSummaries([id], taxBasis === 'inclusive', today());
  const latest = await one<{ t: Date | null }>(
    "SELECT max(updated_at) AS t FROM prices WHERE item_id = $1 AND status = 'active'",
    [id],
  );

  const summary: LowestSummary = summaries.get(id) ?? { is_multi_group: false, groups: [] };
  return {
    ...baseDto(row),
    category_path: categoryPath,
    images: images.map((im) => ({
      id: im.id,
      storage_key: im.storage_key,
      thumb_key: null,
      url: im.url,
      thumb_url: null,
      original_name: im.label ?? '',
      mime: '',
      size_bytes: 0,
      width: im.width,
      height: im.height,
      sort_order: im.sort_order,
      note: null,
      created_at: im.created_at.toISOString(),
    })),
    links: links.map((l) => ({
      id: l.id,
      label: l.label ?? '',
      url: l.url,
      platform: null,
      note: null,
      sort_order: 0,
    })),
    price_summary: {
      supplier_count: row.price_supplier_count,
      lowest_summary: summary,
      latest_updated_at: latest?.t ? latest.t.toISOString() : null,
    },
  };
}
