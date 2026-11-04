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
