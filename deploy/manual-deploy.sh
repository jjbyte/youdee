#!/usr/bin/env bash
#
# 裸机部署（不需要 Docker）。适用于只给了台普通 Linux 机器、且不便装 Docker 的情况。
#
#   用法：cd /opt/youdee && sudo sh deploy/manual-deploy.sh
#
# 前置条件（本脚本不代为安装，装了会污染系统且各发行版差异大）：
#   - Node.js >= 20.19   （node -v 自查；建议 22 LTS，脚本会检查并在低于 22.12 时给出说明）
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

NODE_VER="$(node -v)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"

# node_ge MAJOR MINOR：当前 Node 是否 >= 指定版本
node_ge() {
  [ "$NODE_MAJOR" -gt "$1" ] && return 0
  [ "$NODE_MAJOR" -eq "$1" ] && [ "$NODE_MINOR" -ge "$2" ]
}

echo "[manual] Node $NODE_VER / npm $(npm -v)"
# 带一个脚本指纹：远程排障时最怕"跑的到底是不是新脚本"说不清（本轮就吃过这个亏，
# 只能靠 npm 装的包数反推）。这一行不同，说明解包没覆盖成功。
echo "[manual] 脚本 build 2026-11-04-d / 包版本 $(node -p "require('./package.json').version" 2>/dev/null || echo '未知')"

# 硬底线 20.19：next 16 要 >=20.9，prisma 7 的 engines 明确写了 ^20.19 || ^22.12 || >=24。
if ! node_ge 20 19; then
  echo "[manual] Node 版本过低：$NODE_VER，需要 >= 20.19（建议直接上 22 LTS）" >&2
  echo "[manual] 升级命令：" >&2
  echo "  RHEL 系： curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs" >&2
  echo "  Debian 系：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi

# 软底线 22.12：vitest 5 声明 ^22.12，@prisma/streams-local 声明 >=22（它是 prisma 的间接依赖）。
# 这两个都**不在部署主链路**上 —— 主链路是 generate / build / migrate deploy / start，
# prisma 自己的 engines 允许 ^20.19，所以在 20.19~22.11 上部署是能跑通的，
# 代价只有两个：npm ci 会刷 EBADENGINE 警告（警告不是失败，install 照样成功），
# 以及 npm test 在本机跑不起来（测试在 CI/开发机跑，不需要在生产机上跑）。
# 因此这里只提示、不中止：把话讲明白，比让人对着满屏红色警告猜"是不是装坏了"要好。
if ! node_ge 22 12; then
  cat >&2 <<EOF
[manual] ────────────────────────────────────────────────────────────────
[manual] 提示：Node $NODE_VER 低于 22.12。
[manual] 接下来的 npm ci 会输出若干条 EBADENGINE（vitest、@prisma/streams-local）。
[manual] 那是声明版本不匹配的**警告**，npm 会继续安装，不影响本次部署；请勿中断。
[manual] 影响面：仅 npm test 无法在本机执行。部署主链路不受影响。
[manual] 想让日志干净：升级到 Node 22 LTS 后重跑本脚本。
[manual] ────────────────────────────────────────────────────────────────
EOF
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
# 上面 set -a 已经把 .env 里的 NODE_ENV=production 导出了。npm 看到它就会走
# omit=dev，把 devDependencies 整个跳过 —— 而构建恰恰离不开它们：
#   @tailwindcss/postcss、tailwindcss  → PostCSS 处理 globals.css
#   typescript                        → next build 的类型检查
#   tsx                               → 第 5 步灌种子
# 表现是构建到 CSS 阶段才报 "Cannot find module '@tailwindcss/postcss'"，
# 从报错完全看不出是装包时就少了东西（首次部署真实踩到，日志里 "added 404 packages"
# 就是线索：含 devDeps 应是 554 个）。
# 只在这一步把 NODE_ENV 还原成 development，运行期的 production 不受影响；
# 再补一个 --include=dev 做兜底（与 omit 冲突时 include 优先）。
NODE_ENV=development npm ci --include=dev --no-audit --no-fund

# 装完不是验"目录在不在"—— 目录存在但里面没有 package.json（解包不完整、npm 中途失败）
# 时，[ -d ] 一样为真，构建却照样报 Cannot find module。必须验到文件与真实解析。
MISSING=""
for p in @tailwindcss/postcss tailwindcss typescript prisma tsx; do
  # typescript / prisma / tsx 的包名就是目录名；@tailwindcss/* 也一致
  [ -f "node_modules/$p/package.json" ] || MISSING="$MISSING $p"
done
if [ -n "$MISSING" ]; then
  echo "[manual] 失败：devDependencies 没装上或装残了，缺 package.json 的包:$MISSING" >&2
  echo "[manual] 常见原因：① NODE_ENV=production 让 npm 走了 omit=dev；② 解包不完整。" >&2
  echo "[manual] 当前 node_modules/@tailwindcss 内容：" >&2
  ls -la node_modules/@tailwindcss 2>&1 | sed 's/^/    /' >&2 || true
  echo "[manual] 处理：rm -rf node_modules .next && 重跑本脚本。" >&2
  exit 1
fi

# 真实解析一次：Turbopack 的 PostCSS 转换走 Node 的解析规则，这里解析不了，构建就必然报同一句。
#
# 两个写错过的细节，都记在这儿免得再犯：
#   1) 版本号不能用 require("@tailwindcss/postcss/package.json") 读 —— 该包的 exports
#      只暴露了 "."，子路径 ./package.json 没有导出，require 它会抛
#      ERR_PACKAGE_PATH_NOT_EXPORTED。这不是"包坏了"，但误判成坏包会去补装、
#      反而把好树改坏（实测过：added 1 removed 1）。所以版本号从磁盘读。
#   2) 判断"装没装"不能只看目录存在，要真的 resolve 一次。
resolve_tailwind_postcss() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    let entry;
    try {
      entry = require.resolve("@tailwindcss/postcss");
    } catch (e) {
      console.error("[manual] 无法解析 @tailwindcss/postcss：" + (e.code || "") + " " + e.message);
      process.exit(1);
    }
    // 从入口文件向上找包根，读磁盘上的 package.json（不经 exports）
    let dir = path.dirname(entry);
    let version = "未知版本";
    while (dir !== path.dirname(dir)) {
      const pj = path.join(dir, "package.json");
      if (fs.existsSync(pj)) {
        try { version = JSON.parse(fs.readFileSync(pj, "utf8")).version || version; } catch {}
        break;
      }
      dir = path.dirname(dir);
    }
    console.log("[manual] @tailwindcss/postcss " + version + " -> " + entry);
  '
}

if ! resolve_tailwind_postcss; then
  echo "[manual] PostCSS 插件在当前 node_modules 里解析不到，构建一定会失败，先在这里停下。" >&2
  echo "[manual] 目录现状（目录在 ≠ 包可用，看有没有 package.json）：" >&2
  ls -la node_modules/@tailwindcss 2>&1 | sed 's/^/    /' >&2
  echo "[manual] 处理：rm -rf node_modules .next && sh deploy/manual-deploy.sh" >&2
  exit 1
fi

echo "[manual] 2/6 生成 Prisma 客户端"
npx --no-install prisma generate

echo "[manual] 3/6 构建"
# 先清 .next。上一次失败的产物没有任何复用价值，而且 Turbopack 会从里面读构建缓存，
# 那种"依赖早就装好了、它还在报第一次的 Cannot find module"的假故障，很难与真故障区分。
rm -rf .next
BUILD_LOG=/tmp/youdee-build.log
# 一旦 Turbopack 在某台机器上编不过，下次就别再浪费两分钟试它：留个记号，以后直接走 webpack。
# 想重新让 Turbopack 试一次，删掉这个文件即可（BUILDER=turbopack 可强制单次）。
BUILDER="${BUILDER:-auto}"
if [ "$BUILDER" = "auto" ] && [ -f .build-via-webpack ]; then
  BUILDER=webpack
fi

build_next() { NEXT_TELEMETRY_DISABLED=1 npx --no-install next build "$@"; }

dump_build_failure() {
  echo >&2
  echo "[manual] 构建失败。以下是定位用的现场信息（完整日志：$BUILD_LOG）：" >&2
  echo "[manual] --- PostCSS 插件解析（项目根 / .next 内的转换上下文各一次） ---" >&2
  node -e '
    const path = require("node:path");
    const Module = require("node:module");
    const specs = ["postcss", "@tailwindcss/postcss", "@tailwindcss/node", "tailwindcss"];
    console.log("  从项目根解析：");
    for (const s of specs) {
      try { console.log("    " + s + " -> " + require.resolve(s)); }
      catch (e) { console.log("    " + s + " -> 失败 " + e.code); }
    }
    // Turbopack 的转换代码实际是从 .next/build/chunks 里 require 的。
    // 两处结论不同，就能确定是"解析根"的问题，而不是依赖缺失。
    console.log("  从 .next/build/chunks 解析：");
    const req = Module.createRequire(path.join(process.cwd(), ".next", "build", "chunks", "probe.js"));
    for (const s of specs) {
      try { console.log("    " + s + " -> " + req.resolve(s)); }
      catch (e) { console.log("    " + s + " -> 失败 " + e.code); }
    }
  ' >&2
  echo "[manual] --- node_modules/@tailwindcss ---" >&2
  ls -la node_modules/@tailwindcss 2>&1 | sed 's/^/  /' >&2
  echo "[manual] --- npm 视角 ---" >&2
  NODE_ENV=development npm ls @tailwindcss/postcss --depth=0 2>&1 | sed 's/^/  /' >&2
  echo "[manual] 把上面三块发出来即可定位；不要凭猜测改文件。" >&2
}

# Turbopack 与 webpack 产出等价（同一份源码、同一套 Next 运行时）。
# 部署脚本的职责是"把应用跑起来"，不是"论证某个编译器为何失败"——
# 卡在编译器上等于让一次发包停在与业务无关的点上。两个都失败才算真失败。
if [ "$BUILDER" = "webpack" ]; then
  echo "[manual] 使用 webpack 构建（之前 Turbopack 失败过，记号在 .build-via-webpack）"
  if build_next --webpack 2>&1 | tee "$BUILD_LOG"; then
    :
  else
    dump_build_failure
    exit 1
  fi
elif build_next 2>&1 | tee "$BUILD_LOG"; then
  :
else
  echo >&2
  echo "[manual] Turbopack 构建失败，改用 webpack 重编一次" >&2
  rm -rf .next
  if build_next --webpack 2>&1 | tee -a "$BUILD_LOG"; then
    echo "[manual] webpack 构建通过，本次部署继续；已写 .build-via-webpack，下次直接用 webpack"
    date '+%Y-%m-%d %H:%M:%S Turbopack 失败过，此后回退 webpack' > .build-via-webpack
  else
    dump_build_failure
    exit 1
  fi
fi

# 更新版本时由 deploy/update.sh 传 SKIP_MIGRATE=1 跳过这一步，改到停机窗口里再执行。
# 理由：构建要两三分钟，这段时间线上还跑着旧代码；先动库只会让"构建失败"升级成
# "库已改、代码还是旧的"——旧代码可能不认新结构，那时连回滚都得多想一步。
if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  echo "[manual] 4/6 应用数据库迁移 —— 已跳过（SKIP_MIGRATE=1，由更新脚本在停机窗口内执行）"
else
  echo "[manual] 4/6 应用数据库迁移"
  npx --no-install prisma migrate deploy
fi

echo "[manual] 5/6 灌入种子（已有数据会自动跳过）"
# seed.ts 以"库里有几个用户"为闸门：生产库已有用户时它是空操作，
# 所以更新时照常跑不会覆盖业务数据，只是补上新增的默认行。
if [ "${SKIP_SEED:-0}" = "1" ]; then
  echo "[manual] 5/6 灌入种子 —— 已跳过（SKIP_SEED=1）"
elif [ "${SEED_ON_BOOT:-1}" = "1" ]; then
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
