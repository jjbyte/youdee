import { ok } from '@/server/http';
import { q } from '@/server/db';
import { route } from '@/server/wrap';

/**
 * 健康检查（公开，不带认证）。
 * 数据库不通时仍返回 200 + db=error：这个端点是给探活用来看"进程活着但库挂了"
 * 这种半死状态的，返回 503 会让它和进程崩溃混为一谈。
 */
export const GET = route(async () => {
  let db = 'ok';
  try {
    await q('SELECT 1');
  } catch (e) {
    db = 'error';
    console.error('[health] 数据库连接失败', e);
  }
  return ok({
    status: 'ok',
    db,
    version: process.env.npm_package_version ?? '0.1.0',
    uptime_s: Math.round(process.uptime()),
  });
});
