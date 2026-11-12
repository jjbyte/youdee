import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 版本号到底从哪儿来。
 *
 * 这一小块只解决一个问题：**`/health` 报的版本号必须能证明"跑的是哪份代码"**。
 *
 * 0.1.29 上线时踩的坑：健康检查一直返回 `version=0.1.27`，而交付包里明明是 0.1.29，
 * 磁盘上也是 0.1.29。旧实现读的是 `process.env.npm_package_version` —— 一个由 npm 注入
 * 的环境变量，来源不可见：它可能是 npm 按当前目录的 package.json 现算的，也可能是
 * 上一层 shell 遗留下来的。一旦两者不一致，日志里只剩一个孤零零的 0.1.27，
 * 既不能证明"代码旧"，也不能证明"变量旧"，排查方向全凭猜。
 *
 * 所以改成：**磁盘上的 package.json 是唯一权威**（它就是被部署的那份代码），
 * 环境变量只作为降级手段，并把"这一份是从哪读的"（source）一起报出去。
 * 更新脚本据此判断：source 不是 package.json 就视为不可信，宁可不通过也不要放过。
 */

export type VersionSource = 'package.json' | 'env' | 'unknown';

export type VersionInfo = {
  version: string;
  source: VersionSource;
};

/** 兜底的假版本号：三个来源都没有时用，明确表示"不知道"，绝不冒用某个真版本号 */
const UNKNOWN_VERSION = '0.0.0';

/**
 * 环境变量的形状。故意不用 NodeJS.ProcessEnv：它在本项目的类型里要求 NODE_ENV 必填，
 * 单测里传 `{ npm_package_version: "1.2.3" }` 这种「只关心一个键」的对象会被类型检查挡住，
 * 而为了过类型检查去补 NODE_ENV，等于让测试去迁就类型，反过来掩盖真实用例。
 */
export type EnvLike = Record<string, string | undefined>;

/**
 * 读版本号。`cwd` 与 `env` 可注入，纯函数便于单测 —— 生产上就是 process.cwd()/process.env。
 *
 * 顺序：cwd/package.json → npm_package_version → 0.0.0。
 * 读盘失败（文件不存在、JSON 坏了、version 为空）都安静降级，不能因为读不到版本号让健康检查 500：
 * 这个端点的职责是"报告现状"，它自己挂掉反而把情况变得更难判断。
 */
export function readVersion(cwd: string = process.cwd(), env: EnvLike = process.env): VersionInfo {
  try {
    const raw = readFileSync(path.join(cwd, 'package.json'), 'utf8');
    const version = JSON.parse(raw)?.version;
    if (typeof version === 'string' && version.trim()) {
      return { version: version.trim(), source: 'package.json' };
    }
  } catch {
    // 落到下面用环境变量
  }

  const fromEnv = env.npm_package_version?.trim();
  if (fromEnv) return { version: fromEnv, source: 'env' };

  return { version: UNKNOWN_VERSION, source: 'unknown' };
}

/**
 * 读 .next/BUILD_ID —— `next build` 每次都会重新生成，内容与这次构建一一对应。
 *
 * 它补的是"版本号对了、但跑的仍是上一次编出来的 JS"这个缺口：版本号来自磁盘的
 * package.json，只能说明代码是哪个版本；BUILD_ID 才能说明产物是哪一次构建的。
 * 更新脚本在构建后记下新目录的 BUILD_ID，服务起来后要求 /health 报出同一个值：
 * 不一致就说明进程服务的不是刚构建的那份 .next。
 *
 * 取不到（没构建、路径不对）返回空串 —— 调用方按"无法证明"处理，不要伪造一个值。
 */
export function readBuildId(cwd: string = process.cwd()): string {
  try {
    return readFileSync(path.join(cwd, '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    return '';
  }
}
