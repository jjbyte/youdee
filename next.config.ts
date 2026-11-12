import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 原生/重依赖不进打包器，交给 Node runtime 直接 require。
  // pg 必须在这里：它有动态 require 的 native 绑定，被打包后会找不到。
  // cos-nodejs-sdk-v5 同理：它按需拼请求、依赖 Node 的 http/fs，被 bundle 后
  // 容易出现"开发能传、生产 upload 失败"的差异，交给运行时 require 最稳。
  serverExternalPackages: ['pg', 'sharp', 'exceljs', 'cos-nodejs-sdk-v5'],
  // 钉死工程根，别让 Turbopack 自己向上猜（它按 lockfile/workspace 推断）。
  // 猜错的后果很隐蔽：PostCSS 插件按错误的根去解析，报 "Cannot find module"，
  // 而同一台机器上 node -e "require.resolve(...)" 又是好的 —— 两头对不上，很难查。
  turbopack: { root: process.cwd() },
  // 附件上传走 Route Handler，body 上限在 handler 内单独校验（5MB），
  // 这里不设 bodyParser 上限（App Router 已无此配置项）。
  typescript: { ignoreBuildErrors: false },
  // 注意：别用 `env: { BUILD_STAMP: new Date() }` 来标记构建时间 —— 试过，不成立。
  // Next 把该值写进 .next/required-server-files.json 的 config.env，但**不会**在启动时
  // 回填 process.env（实测 /health 读出来是空串），只有客户端 bundle 会被内联。
  // 现在改成运行期读 .next/BUILD_ID（见 server/services/build-info.ts），
  // 由更新脚本与刚构建出来的那个 BUILD_ID 比对，证据更直接。
};

export default nextConfig;
