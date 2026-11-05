/**
 * 价格的受限修改与归档。
 *
 * 判定按**白名单**而不是黑名单：黑名单漏一个字段就是一次静默丢字段
 * （用户以为改了价，库里没动，还返回 200）。
 * 改金额、单位、性质、折算系数、生效起始日一律 40903 —— 那等于换了一条价，
 * 正确做法是「新增一条 + 关闭旧价」，历史与趋势才留得住。
 */
import { AppError } from '../http';
import { today, tx } from '../db';
import { derivePriceState } from '@/domain/price-resolve';
import type { CurrentUser } from '../auth/session';
import { getPriceRow, tiersByPriceIds, toPriceDTO, type PriceDTO } from '../store/prices.store';
import { staleDaysThreshold } from '../store/settings.store';

const PATCH_ALLOWED_FIELDS = ['source_note', 'effective_to', 'moq', 'tax_rate'];

export interface PatchPriceInput {
  source_note?: string | null;
  effective_to?: string | null;
  moq?: string | null;
  tax_rate?: string | null;
  /**
   * 路由会把请求体里其余的键也原样传进来，**只是为了报 40903**：
   * 路由自己过滤掉 unit_price 之类的字段，就等于把"改金额"变成一次静默无效操作。
   */
  [extra: string]: unknown;
}

export async function patchPrice(id: string, input: PatchPriceInput, actor: CurrentUser): Promise<PriceDTO> {
  const body = input as Record<string, unknown>;
  const touched = Object.keys(body).filter((k) => body[k] !== undefined);
  const violations = touched.filter((k) => !PATCH_ALLOWED_FIELDS.includes(k));
  if (violations.length > 0) {
    throw new AppError(
      40903,
      `价格记录不能就地修改这些字段：${violations.join('、')}。改价请新增一条价格并关闭旧价。`,
      409,
      { detail: { locked_fields: violations } },
    );
  }
  const current = await getPriceRow(id);
  if (!current) throw new AppError(40401, '这条价格不存在。', 404);

  if (input.effective_to !== undefined && input.effective_to !== null) {
    if (input.effective_to < current.effective_from) {
      throw new AppError(40001, '失效日不能早于生效日。', 400, { field: 'effective_to' });
    }
    if (!current.effective_to || input.effective_to > current.effective_to) {
      throw new AppError(
        40903,
        '失效日只能往早改（提前终止）。要延长有效期请新增一条价格覆盖后面的时间。',
        409,
        { field: 'effective_to' },
      );
    }
  }

  const before = {
    source_note: current.source_note,
    moq: current.moq,
    tax_rate: current.tax_rate,
    effective_to: current.effective_to,
  };
  const next = {
    source_note: input.source_note !== undefined ? input.source_note : current.source_note,
    moq: input.moq !== undefined ? input.moq : current.moq,
    tax_rate: input.tax_rate !== undefined ? input.tax_rate : current.tax_rate,
    effective_to: input.effective_to !== undefined ? input.effective_to : current.effective_to,
  };
  await tx(async (c) => {
    await c.query(
      'UPDATE prices SET source_note=$2, moq=$3, tax_rate=$4, effective_to=$5, updated_at=now() WHERE id=$1',
      [id, next.source_note, next.moq, next.tax_rate, next.effective_to],
    );
    await c.query(
      `INSERT INTO price_change_logs (price_id, action, snapshot, prev_snapshot, changed_by, note)
       VALUES ($1,'note_updated',$2::jsonb,$3::jsonb,$4,$5)`,
      [id, JSON.stringify(next), JSON.stringify(before), actor.id, '更新备注/起订量/税率/失效日'],
    );
  });
  const row = await getPriceRow(id);
  const tiers = await tiersByPriceIds([id]);
  return toPriceDTO(row!, tiers.get(id) ?? [], await staleDaysThreshold(), today());
}

/** 归档 = 不再参与比价与取价，历史仍可查（趋势图排除它） */
export async function archivePrice(id: string, reason: string | null, actor: CurrentUser): Promise<PriceDTO> {
  const current = await getPriceRow(id);
  if (!current) throw new AppError(40401, '这条价格不存在。', 404);
  if (current.status !== 'archived') {
    await tx(async (c) => {
      await c.query("UPDATE prices SET status='archived', updated_at=now() WHERE id=$1", [id]);
      await c.query(
        `INSERT INTO price_change_logs (price_id, action, snapshot, prev_snapshot, changed_by, note)
         VALUES ($1,'archived',$2::jsonb,$3::jsonb,$4,$5)`,
        [
          id,
          JSON.stringify({ status: 'archived' }),
          JSON.stringify({ status: current.status }),
          actor.id,
          reason,
        ],
      );
    });
  }
  const row = await getPriceRow(id);
  const tiers = await tiersByPriceIds([id]);
  const stale = await staleDaysThreshold();
  const state = derivePriceState({
    status: 'archived',
    effectiveFrom: row!.effective_from,
    effectiveTo: row!.effective_to,
    lastUsedAt: null,
    updatedAt: row!.updated_at.toISOString(),
    onDate: today(),
    staleDaysThreshold: stale,
  });
  return { ...toPriceDTO(row!, tiers.get(id) ?? [], stale, today()), effective_state: state.state };
}

/**
 * 恢复一条已归档的价（成员可用）。
 *
 * 归档时 EXCLUDE 约束把它从六维空间里放了出来（`WHERE status <> 'archived'`），
 * 所以恢复**可能撞上这期间新录的同口径价**。撞上了不能硬改：两条价在同一段时间
 * 同时有效，取价就变成"看数据库心情"。这里先查一次，把撞上的是哪家、哪段时间说出来，
 * 让人自己决定是先关掉新的那条、还是不要恢复。
 */
export async function restorePrice(id: string, actor: CurrentUser): Promise<PriceDTO> {
  const current = await getPriceRow(id);
  if (!current) throw new AppError(40401, '这条价格不存在。', 404);
  if (current.status !== 'archived') {
    throw new AppError(40907, '这条价没被归档过，不需要恢复。', 409);
  }
  await tx(async (c) => {
    const clash = await c.query<{ id: string; name: string; effective_from: string; effective_to: string | null }>(
      `SELECT p.id, s.name,
              p.effective_from::text AS effective_from,
              p.effective_to::text   AS effective_to
         FROM prices p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id <> $1
          AND p.item_id = $2 AND p.supplier_id = $3 AND p.pricing_nature = $4
          AND p.tax_included = $5 AND COALESCE(p.unit_mode, '') = COALESCE($6, '')
          AND p.status <> 'archived'
          AND daterange(p.effective_from, COALESCE(p.effective_to + 1, 'infinity'::date), '[)')
              && daterange($7::date, COALESCE($8::date + 1, 'infinity'::date), '[)')
        ORDER BY p.effective_from
        LIMIT 1`,
      [
        id,
        current.item_id,
        current.supplier_id,
        current.pricing_nature,
        current.tax_included,
        current.unit_mode,
        current.effective_from,
        current.effective_to,
      ],
    );
    const hit = clash.rows[0];
    if (hit) {
      const span = hit.effective_to ? `${hit.effective_from} 至 ${hit.effective_to}` : `${hit.effective_from} 起`;
      throw new AppError(
        40902,
        `恢复不了：${hit.name} 在这段时间（${span}）已经有一条有效的同口径价，两条并存会让取价不可预期。先把新的那条作废，再恢复这条。`,
        409,
        { detail: { conflict_price_id: hit.id } },
      );
    }
    await c.query("UPDATE prices SET status='active', updated_at=now() WHERE id=$1", [id]);
    await c.query(
      `INSERT INTO price_change_logs (price_id, action, snapshot, prev_snapshot, changed_by, note)
       VALUES ($1,'restored',$2::jsonb,$3::jsonb,$4,$5)`,
      [id, JSON.stringify({ status: 'active' }), JSON.stringify({ status: 'archived' }), actor.id, '撤销作废'],
    );
  });
  const row = await getPriceRow(id);
  const tiers = await tiersByPriceIds([id]);
  return toPriceDTO(row!, tiers.get(id) ?? [], await staleDaysThreshold(), today());
}

/**
 * 真删除（仅管理员）。**连带删掉这条价的变更日志与附件**。
 *
 * 附件（报价截图、供应商链接）跟着价走是显然的；变更日志也一起删，是因为
 * 它记的是"这条价怎么变过"，价本身没了之后这些记录只剩噪音，
 * 而且 price_change_logs 的外键是 RESTRICT——不删它，价根本删不掉。
 *
 * 已发出的报价单不受影响：quote_items.price_id 是 ON DELETE SET NULL，
 * 行上的成本单价与供应商名是快照。
 */
export async function deletePrice(id: string) {
  const current = await getPriceRow(id);
  if (!current) throw new AppError(40401, '这条价格不存在。', 404);
  await tx(async (c) => {
    await c.query('DELETE FROM price_change_logs WHERE price_id = $1', [id]);
    await c.query('DELETE FROM prices WHERE id = $1', [id]);
  });
  return { deleted: true, id };
}
