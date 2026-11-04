import { AppError, intParam, ok, requireUser, searchParams } from '@/server/http';
import { enumParam } from '@/server/params';
import { route } from '@/server/wrap';
import { searchLite } from '@/server/services/items-read.service';

/** 拼单下拉用的轻量搜索：只回 id/名称/单位/首图，不带任何价格 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = searchParams(req);
  const q = (sp.get('q') ?? '').trim();
  if (!q) throw new AppError(40001, '请输入搜索词。', 400, { field: 'q' });
  const limit = intParam(sp, 'limit', 20, 1, 50);
  return ok(await searchLite(q, enumParam(sp, 'item_type', ['material', 'personnel'] as const), limit));
});
