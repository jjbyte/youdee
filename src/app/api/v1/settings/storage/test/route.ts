import { body, ok, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { testCosConnection } from '@/server/services/storage.service';

/**
 * 测试对象存储连接：真的传一个小对象再删掉。
 *
 * 只列桶不够——子账号常被给"只读"策略，列举成功、上传 403，
 * 用户以为配好了，直到真传合同才失败。这里把失败提前到"点按钮的这一刻"，
 * 而且不需要先保存配置（可以边填边测）。
 */
export const POST = route(async (req) => {
  await requireAdmin('测试对象存储连接');
  const b = await body<Record<string, unknown>>(req).catch(() => ({}) as Record<string, unknown>);
  return ok(
    await testCosConnection({
      secret_id: typeof b.secret_id === 'string' ? b.secret_id : undefined,
      secret_key: typeof b.secret_key === 'string' ? b.secret_key : undefined,
      bucket: typeof b.bucket === 'string' ? b.bucket : undefined,
      region: typeof b.region === 'string' ? b.region : undefined,
    }),
  );
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
