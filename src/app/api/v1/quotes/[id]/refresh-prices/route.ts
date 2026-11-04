import { AppError, body, ok, requireOverridePrice, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { refreshPrices } from '@/server/services/quote-refresh.service';

/**
 * 草稿同步最新价 —— 只有 admin（批量改金额，风险等级与改价相同）。
 * dry_run 必传且无默认值：给它默认值就是替用户决定"要不要真的改金额"。
 */
export const POST = route(async (req, params) => {
  await requireOverridePrice();
  const quoteId = reqUuid(params.id, 'id');
  const b = await body<{ item_ids?: unknown[]; dry_run?: boolean; include_manual?: boolean }>(req);
  if (typeof b.dry_run !== 'boolean') {
    throw new AppError(40001, 'dry_run 必传（true=只看差异，false=真的落库）。', 400, { field: 'dry_run' });
  }
  const ids = Array.isArray(b.item_ids) ? b.item_ids.map((id) => reqUuid(id, 'item_ids')) : null;
  return ok(
    await refreshPrices(quoteId, {
      itemIds: ids,
      dryRun: b.dry_run,
      includeManual: b.include_manual === true,
    }),
  );
});
