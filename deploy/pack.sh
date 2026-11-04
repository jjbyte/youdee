#!/usr/bin/env bash
#
# 打交付包。用法：deploy/pack.sh
# 产物：dist/youdee-<版本>-<日期>.tar.gz 与同名 .sha256
#
# 打包原则：只装源码与部署脚本。node_modules / .next / .env / 上传的附件一律排除 ——
# 前两个是平台相关产物（Win 上装的 sharp 到 Linux 会崩），.env 里是密钥，
# 附件是测试残留，都不该跟着交付包走。
# 另外排除两样容易被误用的：根目录 .env.example 是**开发机**模板（连 55432 端口的本地库），
# 部署模板是 deploy/env.example；.npmrc 里写死了开发机的 Windows npm 缓存路径，
# 带到 Linux 上会让 npm ci 直接 EACCES。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(node -p "require('./package.json').version")"
DATE="$(date +%Y%m%d)"
OUT_DIR="dist"
NAME="youdee-${VERSION}-${DATE}"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$NAME.tar.gz"

# ── 门禁：lockfile 必须与 package.json 同步 ────────────────────────────
# Dockerfile 里用的是 `npm ci`，它**不容忍**任何不一致；而开发机上 `npm install`
# 容错更强、装完 node_modules 也就对了，于是 tsc / vitest 全绿、看起来毫无问题，
# 一路推到构建机才在 deps 层炸掉（几十秒白等，报错还只提锁文件不提因果）。
# 这里用同一条命令的 --dry-run 提前判定：只校验不动 node_modules。
if command -v npm >/dev/null 2>&1; then
  if ! npm ci --dry-run --no-audit --no-fund >/tmp/pack-npmci.log 2>&1; then
    echo "[pack] 失败：package-lock.json 与 package.json 不同步，构建机的 npm ci 必然失败。"
    echo "[pack] 修复：npm install --package-lock-only && npm ci --dry-run，然后重新打包。"
    echo "[pack] 原始报错："
    tail -20 /tmp/pack-npmci.log | sed 's/^/    /'
    exit 1
  fi
  echo "[pack] lockfile 同步检查通过"
else
  echo "[pack] 警告：本机无 npm，跳过 lockfile 同步检查"
fi

# ── 门禁：脚本与 Dockerfile 必须是 LF ────────────────────────────────
# 这个坑在本项目踩过两次：Windows 下的文本模式写入会把 \n 变成 \r\n。
# 后果在 Linux 上表现为 "no such file or directory"（CRLF 的 shebang 找不到解释器）
# 或 Dockerfile 的 \ 续行带上 \r —— 报错完全指不到真正原因。
# 用字节判断而不是 grep $'\r'：Git Bash 下空模式会匹配所有文件，误报过一轮。
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const listed = ["Dockerfile", ".dockerignore", ".gitattributes", "docker-compose.yml"];
    if (fs.existsSync("deploy")) {
      for (const f of fs.readdirSync("deploy")) {
        if (/\.(sh|mjs)$/.test(f)) listed.push("deploy/" + f);
      }
    }
    const bad = listed.filter((f) => fs.existsSync(f) && fs.readFileSync(f).includes(13));
    if (bad.length) {
      console.error("[pack] 失败：以下文件含 CR(\\r)，在 Linux 上会以无意义报错失败：");
      for (const f of bad) console.error("    " + f);
      console.error("[pack] 修复：以字节模式把 \\r\\n 换成 \\n（不要用文本模式，会再转回去）。");
      process.exit(1);
    }
  ' || exit 1
  echo "[pack] 换行符检查通过（全部 LF）"
fi

tar -czf "$OUT" \
  --exclude=./node_modules \
  --exclude=./.next \
  --exclude=./.git \
  --exclude=./pgdata \
  --exclude=./.pgtest \
  --exclude=./.workbuddy \
  --exclude=./dist \
  --exclude=./.env \
  --exclude=./.env.local \
  --exclude=./.env.example \
  --exclude=./.npmrc \
  --exclude='./*.log' \
  --exclude=./tsconfig.tsbuildinfo \
  --exclude=./public/uploads \
  --exclude=./var \
  .

# 空目录 tar 不会保留，但运行期要往这里写文件；部署脚本会自己 mkdir，
# 这里只在缺失时提一句，避免交付后有人以为包打漏了。清单只取一次，避免重复解压。
LISTING="$(tar -tzf "$OUT")"
if ! printf '%s\n' "$LISTING" | grep -q 'var'; then
  echo "[pack] 提示：var/uploads 未进包（部署脚本会自动创建，不影响使用）"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
  echo "[pack] 校验值：$(cut -d' ' -f1 "$OUT_DIR/$NAME.tar.gz.sha256")"
fi

echo "[pack] 产物 $OUT"
echo "[pack] 大小 $(du -h "$OUT" | cut -f1)"
echo "[pack] 文件数 $(printf '%s\n' "$LISTING" | wc -l)"
echo "[pack] 顶层内容："
printf '%s\n' "$LISTING" | awk -F/ 'NF>=2 && $2!="" {print $2}' | sort -u | sed 's/^/  /'
