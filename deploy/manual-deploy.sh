#!/usr/bin/env bash
#
# 裸机部署（不需要 Docker）。适用于只给了台普通 Linux 机器、且不便装 Docker 的情况。
#
#   用法：cd /opt/youdee && sudo sh deploy/manual-deploy.sh
#
# 前置条件（本脚本不代为安装，装了会污染系统且各发行版差异大）：
#   - Node.js >= 20.19   （node -v 自查）
#   - PostgreSQL >= 14   （本机或远端都可，连接串写在 .env 的 DATABASE_URL）
#   - 能访问 npm registry（要装依赖、要构建）
#
# 与 Docker 路径的差别：这里直接在当前目录装依赖并构建，产物和 node_modules 都留在原地，
# 所以目录体积会到 1GB 左右，且换机器不能直接拷贝（sharp / pg 是平台相关的二进制）。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[manual] 缺少 $1，请先安装" >&2; exit 1; }; }
need node
need npm

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  echo "[manual] Node 版本过低：$(node -v)，需要 >= 20.19" >&2
  exit 1
fi

if [ ! -f .env ]; then
  umask 077
  echo "[manual] 未发现 .env。先生成一份骨架，DATABASE_URL 需要你填真实值"
  SECRET="$(openssl rand -base64 48 2>/dev/null | tr -d '\n=+/' | cut -c1-64 || echo '')"
  if [ -z "$SECRET" ]; then
    echo "[manual] 没找到 openssl，无法生成 JWT_SECRET。请手动填一个随机长串后重跑" >&2
    exit 1
  fi
  cat > .env <<EOF
DATABASE_URL=postgresql://youdee:请改成真实口令@127.0.0.1:5432/youdee?schema=public
JWT_SECRET=$SECRET
JWT_ACCESS_TTL_MIN=15
JWT_REFRESH_TTL_DAYS=7
UPLOAD_DIR=var/uploads
MAX_UPLOAD_BYTES=5242880
PORT=3000
NODE_ENV=production
SEED_ON_BOOT=1
EOF
  echo "[manual] 已生成 .env，请先改 DATABASE_URL 指向真实数据库，然后重跑本脚本" >&2
  exit 1
fi

# .env 不会被 node 自动加载，后面每一步都显式读进来
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${DATABASE_URL:?.env 里缺 DATABASE_URL}"

# 开发机留下的 .npmrc 里可能有 cache=C:/Users/... 这类 Windows 路径，
# 在 Linux 上会让 npm 直接 EACCES。交付包已排除该文件，这里再兜一次，
# 防止有人直接 tar 了整个工作目录传上来。
if [ -f .npmrc ] && grep -qE '^cache=[A-Za-z]:' .npmrc 2>/dev/null; then
  echo "[manual] 检测到开发机遗留的 .npmrc（Windows 缓存路径），改名停用"
  mv .npmrc .npmrc.disabled
fi

echo "[manual] 1/6 安装依赖"
npm ci --no-audit --no-fund

echo "[manual] 2/6 生成 Prisma 客户端"
npx --no-install prisma generate

echo "[manual] 3/6 构建"
NEXT_TELEMETRY_DISABLED=1 npx --no-install next build

echo "[manual] 4/6 应用数据库迁移"
npx --no-install prisma migrate deploy

echo "[manual] 5/6 灌入种子（已有数据会自动跳过）"
if [ "${SEED_ON_BOOT:-1}" = "1" ]; then
  npx --no-install tsx prisma/seed.ts
fi

mkdir -p "${UPLOAD_DIR:-var/uploads}"
chmod +x deploy/*.sh

echo "[manual] 6/6 完成。启动方式二选一："
echo "  A) 前台试跑（看日志方便）：npx next start -H 0.0.0.0 -p ${PORT:-3000}"
echo "  B) 交给 systemd（推荐）："
echo "     sudo cp deploy/youdee.service /etc/systemd/system/youdee.service"
echo "     sudo systemctl daemon-reload && sudo systemctl enable --now youdee"
echo
echo "启动后跑一次自检：node deploy/verify.mjs"
