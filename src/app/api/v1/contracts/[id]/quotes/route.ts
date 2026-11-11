import { AppError, body, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { linkQuote, listLinkedQuotes } from '@/server/services/contract.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 合同关联的系统报价单列表 */
export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await listLinkedQuotes(reqUuid(params.id, 'id')));
});

/**
 * 关联一张已有报价单。
 *
 * 幂等：重复关联不报 409。合同详情页是多手点的地方，
 * 点两下弹个红条只会让人以为自己操作错了。
 */
export const POST = route(async (req, params) => {
  const actor = await requireUser();
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const quoteId = typeof b.quote_id === 'string' ? b.quote_id.trim() : '';
  if (!UUID.test(quoteId)) throw new AppError(40001, '请选择要关联的报价单。', 400, { field: 'quote_id' });
  const r = await linkQuote(id, quoteId, actor);
  return ok({ linked: r.linked, quotes: r.quotes }, r.linked ? 201 : 200);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
