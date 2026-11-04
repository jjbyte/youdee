import { ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { riskCheck } from '@/server/services/risk.service';

/**
 * 发送前自检。只返回清单，不改状态、不阻断。
 * GET 与 POST 都实现：文档里是 POST（它会读当前阈值），前端习惯用 GET 也不会挂。
 */
export const GET = route(async (_req, params) => {
  await requireUser();
  return ok(await riskCheck(reqUuid(params.id, 'id')));
});

export const POST = GET;
