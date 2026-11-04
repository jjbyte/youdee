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
