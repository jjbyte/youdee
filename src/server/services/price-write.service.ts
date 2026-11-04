/**
 * 价格写入：新建（含「新增并关闭旧价」标准调价流程）。
 *
 * 三条铁律落在这里：
 *   1) 改价 = 新增一条 + 关闭旧价，**不原地 UPDATE 金额**（否则历史趋势与审计全废）；
 *   2) 区间重叠靠数据库 EXCLUDE 兜底（并发安全），预检只为给前端一条可读的建议关闭日；
 *   3) 六维唯一键里的字段（供应商/单位/性质/税口径/折算系数）换了，就是换了被比较的对象 —— 42207。
 *
 * 受限修改与归档见 price-patch.service：它们不动区间结构，混进来会让这份文件读起来像同一件事。
 */
import { AppError } from '../http';
import { addDays } from '../dates';
import { one, today, tx } from '../db';
import { unitModeOf } from '@/domain/units';
import type { CurrentUser } from '../auth/session';
import { getPriceRow, run, tiersByPriceIds, toPriceDTO, type PriceDTO } from '../store/prices.store';
import { staleDaysThreshold } from '../store/settings.store';
import { findOverlaps, overlapError } from './price-overlap.service';

export interface PriceTierInput {
  min_qty: string;
  unit_price: string;
}

export interface CreatePriceInput {
  item_id: string;
  supplier_id: string;
  unit_code: string;
  pricing_nature: string;
  unit_price: string;
  effective_from: string;
  base_unit_qty?: string | null;
  currency?: string;
  tax_included?: boolean;
  tax_rate?: string | null;
  moq?: string | null;
  effective_to?: string | null;
  source_note?: string | null;
  tiers?: PriceTierInput[];
  close_previous?: boolean;
}

interface ItemBrief {
  id: string;
  item_type: string;
  base_unit_code: string;
  compare_unit_code: string | null;
}

async function loadItem(itemId: string): Promise<ItemBrief> {
  const row = await one<ItemBrief>(
    'SELECT id, item_type, base_unit_code, compare_unit_code FROM items WHERE id = $1',
    [itemId],
  );
  if (!row) throw new AppError(40401, '这个计价主体不存在。', 404);
  return row;
}

/**
 * 折算系数校验：NULL 表示"没填/不知道"，填了就必须 > 0 且 ≠ 1。
 * 填 1 等于断言"两个单位一致"，而单位不一致时这句话就是错的 —— 它会静默污染比价。
 */
function checkBaseUnitQty(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(42201, '折算系数必须大于 0。', 422, { field: 'base_unit_qty' });
  if (n === 1) {
    throw new AppError(42201, '折算系数为 1 等于说两个单位相同。单位不同请填真实换算值，单位相同请留空。', 422, {
      field: 'base_unit_qty',
    });
  }
  return raw;
}

function checkTiers(tiers: PriceTierInput[] | undefined): PriceTierInput[] {
  if (!tiers || tiers.length === 0) return [];
  const seen = new Set<string>();
  for (const t of tiers) {
    const min = Number(t.min_qty);
    if (!Number.isFinite(min) || min <= 0) {
      throw new AppError(42202, '阶梯档位起点必须大于 0。', 422, { field: 'tiers' });
    }
    const key = min.toFixed(2);
    if (seen.has(key)) throw new AppError(42202, `阶梯里有两档都从 ${key} 起，请合并。`, 422, { field: 'tiers' });
    seen.add(key);
  }
  return [...tiers].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
}

export async function createPrice(
  actor: CurrentUser,
  input: CreatePriceInput,
): Promise<PriceDTO & { previous_closed_id: string | null }> {
  if ('id' in input) {
    throw new AppError(42207, '新建价格不接受 id。要改已有价格请新增一条并关闭旧价。', 422);
  }
  const item = await loadItem(input.item_id);
  const supplier = await one<{ id: string }>('SELECT id FROM suppliers WHERE id = $1', [input.supplier_id]);
  if (!supplier) throw new AppError(40401, '这个供应商不存在。', 404);

  let nature = input.pricing_nature;
  if (item.item_type === 'personnel') {
    // 人员恒为 service：该列进 EXCLUDE 唯一键，若允许自由取值，同一讲师可并存两条按天价
    if (nature && nature !== 'service') {
      throw new AppError(42201, '人员类主体的交易性质只能是「服务」，不能选买断或租赁。', 422, {
        field: 'pricing_nature',
      });
    }
    nature = 'service';
  }
  if (!nature) throw new AppError(40001, '交易性质不能为空。', 400, { field: 'pricing_nature' });

  const baseUnitQty = checkBaseUnitQty(input.base_unit_qty);
  const tiers = checkTiers(input.tiers);
  const taxIncluded = input.tax_included ?? true;
  const unitMode = unitModeOf(input.unit_code);
  const to = input.effective_to ?? null;
  if (to && to < input.effective_from) {
    throw new AppError(40001, '失效日不能早于生效日。', 400, { field: 'effective_to' });
  }

  const overlaps = await findOverlaps(
    null,
    { itemId: input.item_id, supplierId: input.supplier_id, nature, taxIncluded, unitMode },
    input.effective_from,
    to,
  );
  const closePrevious = input.close_previous === true;
  if (overlaps.length > 0 && !closePrevious) throw overlapError(overlaps, input.effective_from);

  const { prevClosedId, newId } = await tx(async (c) => {
    let closedId: string | null = null;
    if (closePrevious) {
      // 必须定位到「恰好 1 条」覆盖新生效日的现行价：
      // 0 条说明他想用"关掉别人家的价"来实现改价，2 条说明数据里有并发逃逸
      const covering = await run<{ id: string; base_unit_qty: string | null; effective_from: string }>(
        c,
        `SELECT id, base_unit_qty, effective_from FROM prices
          WHERE item_id = $1 AND supplier_id = $2 AND pricing_nature = $3 AND tax_included = $4
            AND COALESCE(unit_mode, '') = COALESCE($5, '') AND status = 'active'
            AND effective_from <= $6::date AND (effective_to IS NULL OR effective_to >= $6::date)
          FOR UPDATE`,
        [input.item_id, input.supplier_id, nature, taxIncluded, unitMode, input.effective_from],
      );
      if (covering.length !== 1) {
        throw new AppError(
          42207,
          '找不到唯一一条可以关闭的现行价（或同一口径下有多条）。请确认供应商、单位、交易性质、含税口径与原价一致后重试。',
          422,
          { field: 'close_previous' },
        );
      }
      const prev = covering[0]!;
      const a = prev.base_unit_qty === null ? null : Number(prev.base_unit_qty);
      const b = baseUnitQty === null ? null : Number(baseUnitQty);
      if (a !== b) {
        throw new AppError(
          42207,
          '新价格的折算系数与原价不一致。这等于换了一个被比较的对象，请改用「新建价格」而不是调价。',
          422,
          { field: 'base_unit_qty' },
        );
      }
      const others = await findOverlaps(
        c,
        { itemId: input.item_id, supplierId: input.supplier_id, nature, taxIncluded, unitMode },
        input.effective_from,
        to,
      );
      if (others.some((o) => o.id !== prev.id)) throw overlapError(others, input.effective_from);

      const snapshot = { status: 'superseded', effectiveTo: addDays(input.effective_from, -1) };
      await c.query(
        `UPDATE prices SET effective_to = ($2::date - INTERVAL '1 day')::date, status = 'superseded', updated_at = now()
          WHERE id = $1`,
        [prev.id, input.effective_from],
      );
      await c.query(
        `INSERT INTO price_change_logs (price_id, action, snapshot, prev_snapshot, changed_by, note)
         VALUES ($1, 'superseded', $2::jsonb, $3::jsonb, $4, $5)`,
        [
          prev.id,
          JSON.stringify(snapshot),
          JSON.stringify({ status: 'active', effectiveTo: null, effectiveFrom: prev.effective_from }),
          actor.id,
          '被新版本替代',
        ],
      );
      closedId = prev.id;
    }

    const inserted = await c.query<{ id: string }>(
      // 注意：绝不能出现 unit_mode（GENERATED 列，写它会 500）
      `INSERT INTO prices (item_id, supplier_id, unit_code, base_unit_qty, unit_price, currency, tax_included,
                           pricing_nature, tax_rate, moq, effective_from, effective_to, status, source_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14)
       RETURNING id`,
      [
        input.item_id,
        input.supplier_id,
        input.unit_code,
        baseUnitQty,
        input.unit_price,
        input.currency ?? 'CNY',
        taxIncluded,
        nature,
        input.tax_rate ?? null,
        input.moq ?? null,
        input.effective_from,
        to,
        input.source_note ?? null,
        actor.id,
      ],
    );
    const newId = inserted.rows[0]!.id;

    for (const t of tiers) {
      await c.query('INSERT INTO price_tiers (price_id, min_qty, unit_price) VALUES ($1,$2,$3)', [
        newId,
        t.min_qty,
        t.unit_price,
      ]);
    }
    await c.query(
      `INSERT INTO price_change_logs (price_id, action, snapshot, prev_snapshot, changed_by, note)
       VALUES ($1, 'created', $2::jsonb, NULL, $3, $4)`,
      [
        newId,
        JSON.stringify({
          unitPrice: input.unit_price,
          unitCode: input.unit_code,
          baseUnitQty,
          taxIncluded,
          pricingNature: nature,
          effectiveFrom: input.effective_from,
          effectiveTo: to,
          tiers,
        }),
        actor.id,
        input.source_note ?? null,
      ],
    );
    return { prevClosedId: closedId, newId };
  });

  const row = await getPriceRow(newId);
  if (!row) throw new AppError(50001, '价格已保存但读取失败，请刷新页面确认。', 500);
  const tiersMap = await tiersByPriceIds([newId]);
  const dto = toPriceDTO(row, tiersMap.get(newId) ?? [], await staleDaysThreshold(), today());
  return { ...dto, previous_closed_id: prevClosedId };
}
