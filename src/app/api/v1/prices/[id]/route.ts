import { body, ok, optDate, optDecimal, optStr, requireOverridePrice, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { getPriceDetail } from '@/server/services/price-read.service';
import { patchPrice } from '@/server/services/price-patch.service';

export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await getPriceDetail(reqUuid(params.id, 'id')));
});

/**
 * 只允许改 source_note / moq / tax_rate / 提前 effective_to。
 * 金额、单位、性质、折算系数、生效起始日一律 40903 —— 改这些等于换了一条价，
 * 正确做法是「新增一条 + 关闭旧价」，这样历史与趋势才留得住。
 *
 * 路由**不过滤**请求体里其余字段：把它们原样交给 service，
 * 才能对"想改金额"这类请求回 40903；路由自己丢掉未知字段等于静默返回 200 却没改任何东西。
 */
export const PATCH = route(async (req, params) => {
  const actor = await requireOverridePrice();
  const id = reqUuid(params.id, 'id');
  const b = await body<Record<string, unknown>>(req);
  const updated = await patchPrice(
    id,
    {
      ...b,
      source_note: b.source_note === undefined ? undefined : optStr(b.source_note, 200),
      effective_to: b.effective_to === undefined ? undefined : optDate(b.effective_to, '失效日'),
      moq: b.moq === undefined ? undefined : optDecimal(b.moq, '起订量'),
      tax_rate: b.tax_rate === undefined ? undefined : optDecimal(b.tax_rate, '税率'),
    },
    actor,
  );
  return ok(updated);
});
