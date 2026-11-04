import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 原生/重依赖不进打包器，交给 Node runtime 直接 require。
  // pg 必须在这里：它有动态 require 的 native 绑定，被打包后会找不到。
  serverExternalPackages: ['pg', 'sharp', 'exceljs'],
  // 钉死工程根，别让 Turbopack 自己向上猜（它按 lockfile/workspace 推断）。
  // 猜错的后果很隐蔽：PostCSS 插件按错误的根去解析，报 "Cannot find module"，
  // 而同一台机器上 node -e "require.resolve(...)" 又是好的 —— 两头对不上，很难查。
  turbopack: { root: process.cwd() },
  // 附件上传走 Route Handler，body 上限在 handler 内单独校验（5MB），
  // 这里不设 bodyParser 上限（App Router 已无此配置项）。
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
