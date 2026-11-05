import { body, ok, optStr, requireArchive, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { archivePrice } from '@/server/services/price-patch.service';

/**
 * 作废（归档）= 不再参与比价与取价，历史仍可查，随时能 /restore 回来。
 *
 * 0.1.12 及以前这里卡的是 requireOverridePrice（仅管理员）。改价的判定没变，
 * 但**作废是可逆的**，锁给管理员只会让"录错了一条价"卡在等管理员上——
 * 而错价留在库里一天，它就可能被取进一张真的报价单。
 */
export const POST = route(async (req, params) => {
  const actor = await requireArchive('作废价格');
  const id = reqUuid(params.id, 'id');
  const b = await body<{ reason?: string }>(req).catch(() => ({ reason: undefined }));
  return ok(await archivePrice(id, optStr(b.reason, 200), actor));
});
