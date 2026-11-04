/**
 * 分类（物料 / 人员双域两棵树）。
 *
 * 交易性质的预填值在服务端解析成 effective_pricing_nature = COALESCE(本节点, 父节点, 'purchase')。
 * 前端口径只认这一个字段：上溯逻辑写两遍，迟早出现"分类页显示租赁、录价表单显示买断"。
 */
import { q, one } from '../db';
import { AppError } from '../http';
import { PRICING_NATURES, type PricingNature } from '@/domain/units';

// ── 分类 ────────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  domain: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  default_pricing_nature: string | null;
  item_count: number;
}

export interface CategoryNodeDTO {
  id: string;
  domain: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  default_pricing_nature: string | null;
  effective_pricing_nature: PricingNature;
  item_count: number;
  children: CategoryNodeDTO[];
}

export async function categoryTree(domain: string | null, includeCounts: boolean): Promise<CategoryNodeDTO[]> {
  const params: unknown[] = [];
  let where = '';
  if (domain) {
    params.push(domain);
    where = 'WHERE c.domain = $1';
  }
  const rows = await q<CategoryRow>(
    `SELECT c.id, c.domain, c.name, c.parent_id, c.sort_order, c.default_pricing_nature,
            ${includeCounts ? '(SELECT count(*) FROM items i WHERE i.category_id = c.id)::int' : '0'} AS item_count
       FROM categories c ${where}
      ORDER BY c.domain, c.sort_order, c.name`,
    params,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nodes = new Map<string, CategoryNodeDTO>();
  const rootNature = (r: CategoryRow): PricingNature => {
    const own = r.default_pricing_nature as PricingNature | null;
    if (own) return own;
    const parent = r.parent_id ? byId.get(r.parent_id) : null;
    const parentNature = parent?.default_pricing_nature as PricingNature | null;
    return parentNature ?? 'purchase';
  };
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      domain: r.domain,
      parent_id: r.parent_id,
      name: r.name,
      sort_order: r.sort_order,
      default_pricing_nature: r.default_pricing_nature,
      effective_pricing_nature: rootNature(r),
      item_count: r.item_count,
      children: [],
    });
  }
  const roots: CategoryNodeDTO[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    if (r.parent_id && nodes.has(r.parent_id)) {
      nodes.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // 父节点的 item_count 要含子孙，否则"这个分类下有 0 个主体"会误导人
  for (const root of roots) {
    root.item_count += root.children.reduce((s, c) => s + c.item_count, 0);
  }
  return roots;
}

async function categoryById(id: string): Promise<CategoryRow> {
  const row = await one<CategoryRow>(
    'SELECT id, domain, name, parent_id, sort_order, default_pricing_nature, 0 AS item_count FROM categories WHERE id = $1',
    [id],
  );
  if (!row) throw new AppError(40401, '这个分类不存在。', 404);
  return row;
}

function checkNature(nature: string | null | undefined): string | null {
  if (nature === null || nature === undefined) return null;
  if (!PRICING_NATURES.includes(nature as never)) {
    throw new AppError(40001, '交易性质不在允许值内。', 400, { field: 'default_pricing_nature' });
  }
  return nature;
}

export async function createCategory(input: {
  domain: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number;
  default_pricing_nature?: string | null;
}) {
  if (input.parent_id) {
    const parent = await categoryById(input.parent_id);
    if (parent.domain !== input.domain) {
      throw new AppError(42206, '子分类的领域必须与父分类一致。', 422, { field: 'parent_id' });
    }
    if (parent.parent_id) {
      throw new AppError(42206, '分类最多两级，不能再往下挂。', 422, { field: 'parent_id' });
    }
  }
  const rows = await q<{ id: string }>(
    `INSERT INTO categories (domain, name, parent_id, sort_order, default_pricing_nature)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      input.domain,
      input.name,
      input.parent_id ?? null,
      input.sort_order ?? 0,
      checkNature(input.default_pricing_nature),
    ],
  );
  return categoryById(rows[0]!.id);
}

export async function patchCategory(
  id: string,
  input: {
    name?: string;
    parent_id?: string | null;
    sort_order?: number;
    default_pricing_nature?: string | null;
  },
) {
  const current = await categoryById(id);
  let parentId = input.parent_id !== undefined ? input.parent_id : current.parent_id;
  if (parentId) {
    if (parentId === id) throw new AppError(42206, '分类不能挂到自己下面。', 422, { field: 'parent_id' });
    const parent = await categoryById(parentId);
    if (parent.domain !== current.domain) {
      throw new AppError(42206, '分类不能跨领域移动。', 422, { field: 'parent_id' });
    }
    if (parent.parent_id) throw new AppError(42206, '分类最多两级。', 422, { field: 'parent_id' });
    const children = await one<{ n: string }>(
      'SELECT count(*)::text AS n FROM categories WHERE parent_id = $1',
      [id],
    );
    if (Number(children?.n ?? 0) > 0 && parentId !== current.parent_id) {
      throw new AppError(42206, '这个分类下面还有子分类，移到别的父节点会变成三级。', 422, { field: 'parent_id' });
    }
  }
  await q(
    `UPDATE categories SET name=$2, parent_id=$3, sort_order=$4, default_pricing_nature=$5 WHERE id=$1`,
    [
      id,
      input.name ?? current.name,
      parentId ?? null,
      input.sort_order ?? current.sort_order,
      input.default_pricing_nature !== undefined
        ? checkNature(input.default_pricing_nature)
        : current.default_pricing_nature,
    ],
  );
  return categoryById(id);
}

export async function deleteCategory(id: string) {
  await categoryById(id);
  const children = await one<{ n: string }>('SELECT count(*)::text AS n FROM categories WHERE parent_id = $1', [id]);
  if (Number(children?.n ?? 0) > 0) {
    throw new AppError(40904, '这个分类下面还有子分类，先删子分类。', 409);
  }
  const items = await one<{ n: string }>('SELECT count(*)::text AS n FROM items WHERE category_id = $1', [id]);
  if (Number(items?.n ?? 0) > 0) {
    throw new AppError(40904, '这个分类下面还有计价主体，不能删除。', 409);
  }
  await q('DELETE FROM categories WHERE id = $1', [id]);
}
