import { ok } from '@/server/http';
import { q } from '@/server/db';
import { route } from '@/server/wrap';
import { readBuildId, readVersion } from '@/server/services/build-info';

/**
 * 健康检查（公开，不带认证）。探活与更新脚本都靠它。
 * 数据库不通时仍返回 200 + db=error：这个端点是给探活用来看"进程活着但库挂了"
 * 这种半死状态的，返回 503 会让它和进程崩溃混为一谈。
 *
 * 版本相关的字段各有分工，不能再合并成一个（合并就退回到"只报一个数字、然后猜它是哪来的"）：
 *   version        磁盘 package.json 里的版本 = 被部署的这份代码是什么版本
 *   version_source 上面那个值从哪读的；不是 package.json 就不可信，更新脚本直接判失败
 *   build_id       磁盘 .next/BUILD_ID = 这份产物是哪一次构建的
 *   npm_version    仅供排错：npm 注入的环境变量，它谎报过（0.1.29 上线时报了 0.1.27）
 *   cwd            进程的工作目录；不是发布目录时，一切都对不上
 */
export const GET = route(async () => {
  let db = 'ok';
  try {
    await q('SELECT 1');
  } catch (e) {
    db = 'error';
    console.error('[health] 数据库连接失败', e);
  }

  const { version, source } = readVersion();

  return ok({
    status: 'ok',
    db,
    version,
    version_source: source,
    build_id: readBuildId(),
    npm_version: process.env.npm_package_version ?? '',
    cwd: process.cwd(),
    uptime_s: Math.round(process.uptime()),
  });
});
