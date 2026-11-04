/**
 * 区间重叠预检。
 *
 * 真正的并发安全靠数据库 EXCLUDE 约束（23P01 → 40902），这里只做两件事：
 *   1) 给前端一条可读的话 + 一个"建议关闭日"，让「新增并关闭旧价」一步点到；
 *   2) 把六维键相同的既有区间找出来，供 createPrice 在关闭旧价时校验没有关错人。
 *
 * 单独成文件的原因：这两段是纯查询与纯报错构造，没有事务、没有金额，
 * 混在 createPrice 里会让"改价流程"的代码读起来像在处理重叠算法。
 */
import { AppError } from '../http';
import { addDays } from '../dates';
import { run } from '../store/prices.store';

export interface OverlapRow {
  id: string;
  supplier_name: string;
  effective_from: string;
  effective_to: string | null;
}

/** 与新区间有交叠的当前记录（含 superseded —— 六维键里它们同样占用区间） */
export async function findOverlaps(
  c: Parameters<typeof run>[0],
  p: { itemId: string; supplierId: string; nature: string; taxIncluded: boolean; unitMode: string | null },
  from: string,
  to: string | null,
): Promise<OverlapRow[]> {
  return run<OverlapRow>(
    c,
    `SELECT p.id, s.name AS supplier_name, p.effective_from, p.effective_to
       FROM prices p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.item_id = $1 AND p.supplier_id = $2 AND p.pricing_nature = $3
        AND p.tax_included = $4 AND COALESCE(p.unit_mode, '') = COALESCE($5, '')
        AND p.status <> 'archived'
        AND daterange(p.effective_from, COALESCE(p.effective_to + 1, 'infinity'::date), '[)')
            && daterange($6::date, COALESCE($7::date + 1, 'infinity'::date), '[)')
      ORDER BY p.effective_from`,
    [p.itemId, p.supplierId, p.nature, p.taxIncluded, p.unitMode, from, to],
  );
}

/**
 * 40902 的响应体：detail.proposed_close 给"建议把旧价关到哪天"，
 * 同时在**顶层**再放一份 —— openapi 的 ErrorEnvelope 就是这么写的，前端按顶层取。
 */
export function overlapError(rows: OverlapRow[], from: string): AppError {
  const first = rows[0]!;
  const closeDate = addDays(from, -1);
  const proposed = {
    price_id: first.id,
    supplier_name: first.supplier_name,
    close_effective_to: closeDate,
    current_effective_to: first.effective_to,
  };
  return new AppError(
    40902,
    `${first.supplier_name} 在 ${first.effective_from} 起已经有一段价格，与新录入的生效期重叠。`
      + '如果是调价，请用「新增并关闭旧价」把旧价结束日设为新价生效日的前一天。',
    409,
    { field: 'effective_from', detail: { proposed_close: proposed } },
    { proposed_close: proposed },
  );
}
