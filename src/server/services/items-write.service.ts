/**
 * 计价主体的写路径（建 / 改 / 停用）。
 *
 * 停用而非删除：历史报价单引用的主体名必须还能解析出来。
 * 有价格记录后不允许改基准单位（42204）：换单位等于把历史价全部换了口径。
 */
import { one, q, tx } from '../db';
import { AppError } from '../http';
import { ITEM_SELECT, getItemDetail, type ItemRow } from './items-read.service';

export interface CurrentUserLike {
  id: string;
}

export interface ItemInput {
  item_type: string;
  category_id: string;
  name: string;
  base_unit_code: string;
  compare_unit_code?: string | null;
  spec?: string | null;
  aliases?: string[] | null;
  includes_travel?: boolean | null;
  is_active?: boolean;
}

async function assertCategoryDomain(categoryId: string, itemType: string): Promise<void> {
  const cat = await one<{ domain: string }>('SELECT domain FROM categories WHERE id = $1', [categoryId]);
  if (!cat) throw new AppError(40001, '分类不存在。', 400, { field: 'category_id' });
  if (cat.domain !== itemType) {
    throw new AppError(42206, '分类的领域与主体类型不一致（物料只能用物料分类）。', 422, { field: 'category_id' });
  }
}

async function assertUnit(code: string | null | undefined, field: string): Promise<void> {
  if (!code) return;
  const u = await one<{ code: string }>('SELECT code FROM units WHERE code = $1', [code]);
  if (!u) throw new AppError(40001, '单位不存在。', 400, { field });
}

export async function createItem(actor: CurrentUserLike, input: ItemInput) {
  if (input.item_type !== 'material' && input.item_type !== 'personnel') {
    throw new AppError(40001, 'item_type 只能是 material 或 personnel。', 400, { field: 'item_type' });
  }
  await assertCategoryDomain(input.category_id, input.item_type);
  await assertUnit(input.base_unit_code, 'base_unit_code');
  await assertUnit(input.compare_unit_code, 'compare_unit_code');
  const rows = await q<{ id: string }>(
    `INSERT INTO items (item_type, category_id, name, aliases, spec, base_unit_code, compare_unit_code,
                        includes_travel, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      input.item_type,
      input.category_id,
      input.name,
      input.aliases ?? [],
      input.spec ?? null,
      input.base_unit_code,
      input.compare_unit_code ?? null,
      input.includes_travel ?? null,
      input.is_active ?? true,
      actor.id,
    ],
  );
  return getItemDetail(rows[0]!.id);
}

export async function patchItem(id: string, input: Partial<ItemInput>) {
  const current = await one<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
  if (!current) throw new AppError(40401, '这个计价主体不存在。', 404);

  if (input.base_unit_code && input.base_unit_code !== current.base_unit_code) {
    const used = await one<{ n: string }>('SELECT count(*)::text AS n FROM prices WHERE item_id = $1', [id]);
    if (Number(used?.n ?? 0) > 0) {
      throw new AppError(
        42204,
        '这个主体已经有价格记录了，不能再改基准单位（换了单位等于把历史价全部换了口径）。',
        422,
        { field: 'base_unit_code' },
      );
    }
    await assertUnit(input.base_unit_code, 'base_unit_code');
  }
  const itemType = input.item_type ?? current.item_type;
  const categoryId = input.category_id ?? current.category_id;
  if (input.category_id || input.item_type) await assertCategoryDomain(categoryId, itemType);
  if (input.compare_unit_code) await assertUnit(input.compare_unit_code, 'compare_unit_code');

  await q(
    `UPDATE items SET item_type=$2, category_id=$3, name=$4, aliases=$5, spec=$6, base_unit_code=$7,
            compare_unit_code=$8, includes_travel=$9, is_active=$10, updated_at=now()
      WHERE id=$1`,
    [
      id,
      itemType,
      categoryId,
      input.name ?? current.name,
      input.aliases ?? current.aliases,
      input.spec !== undefined ? input.spec : current.spec,
      input.base_unit_code ?? current.base_unit_code,
      input.compare_unit_code !== undefined ? input.compare_unit_code : current.compare_unit_code,
      input.includes_travel !== undefined ? input.includes_travel : current.includes_travel,
      input.is_active !== undefined ? input.is_active : current.is_active,
    ],
  );
  return getItemDetail(id);
}

export async function deactivateItem(id: string) {
  const row = await one<{ id: string }>('SELECT id FROM items WHERE id = $1', [id]);
  if (!row) throw new AppError(40401, '这个计价主体不存在。', 404);
  await q('UPDATE items SET is_active = false, updated_at = now() WHERE id = $1', [id]);
  return { is_active: false };
}

/** 作废 / 恢复：同一个动作的两个方向，只有 is_active 一位之差 */
export async function setItemActive(id: string, active: boolean) {
  const row = await one<{ id: string; name: string }>('SELECT id, name FROM items WHERE id = $1', [id]);
  if (!row) throw new AppError(40401, '这个计价主体不存在。', 404);
  await q('UPDATE items SET is_active = $2, updated_at = now() WHERE id = $1', [id, active]);
  // 返回体一律 snake_case（接口约定），前端边界统一转 camelCase——
  // 这里写 isActive 的话，前端拿到的键名跟别处不一致，自检脚本也会读空
  return { id: row.id, name: row.name, is_active: active };
}

/** 删之前先数清楚会连带删掉什么——确认框要写具体数字，否则等于让用户闭眼点 */
export async function itemDeleteImpact(id: string) {
  const row = await one<{ id: string; name: string; item_type: string }>(
    'SELECT id, name, item_type FROM items WHERE id = $1',
    [id],
  );
  if (!row) throw new AppError(40401, '这个计价主体不存在。', 404);
  const counts = await one<{ prices: string; quotes: string }>(
    `SELECT (SELECT count(*) FROM prices WHERE item_id = $1)::text AS prices,
            (SELECT count(DISTINCT quote_id) FROM quote_items WHERE item_id = $1)::text AS quotes`,
    [id],
  );
  return {
    id: row.id,
    name: row.name,
    itemType: row.item_type,
    priceCount: Number(counts?.prices ?? 0),
    quoteCount: Number(counts?.quotes ?? 0),
  };
}

/**
 * 真删除（仅管理员）。**连带删掉这个主体自己的价格记录**。
 *
 * 为什么连带而不是拒绝（对比供应商那条是拒绝）：
 *   价格是主体自己的属性，"删物料却留下它的价"会造出一批查不到主体的孤儿价，
 *   它们既不参与比价（item 没了），又永远占着库——比连带删掉更难收拾。
 *   供应商不一样：它被多个物料共用，删一家会连带删掉几十个物料的价，爆炸半径完全不同。
 *
 * 历史报价单不受影响：quote_items 的 item_id / price_id 是 ON DELETE SET NULL，
 * 行上用 item_name_snapshot 等快照字段，客户手里那份的数字不会变。
 */
export async function deleteItem(id: string) {
  const impact = await itemDeleteImpact(id);
  await tx(async (c) => {
    // price_change_logs 是 RESTRICT：不先删它，价就删不掉
    await c.query(
      `DELETE FROM price_change_logs
        WHERE price_id IN (SELECT id FROM prices WHERE item_id = $1)`,
      [id],
    );
    // price_tiers / price_attachments 是 CASCADE，跟着价一起走
    await c.query('DELETE FROM prices WHERE item_id = $1', [id]);
    await c.query('DELETE FROM items WHERE id = $1', [id]);
  });
  return { deleted: true, name: impact.name, priceCount: impact.priceCount };
}
