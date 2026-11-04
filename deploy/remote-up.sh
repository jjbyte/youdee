#!/usr/bin/env sh
# 远端执行：首次生成 .env → 构建并起服务 → 等到健康。
# 由 deploy.sh 通过 ssh 调用，也可以登到服务器后手动跑。
set -eu

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "[up] 工作目录 $ROOT"

# compose 有两种装法：插件（docker compose）与独立二进制（docker-compose）。
# 两种都试，别让用户为了这个去改机器。
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "[up] 没找到 docker compose。先跑 deploy/bootstrap.sh 装环境。" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "[up] 未发现 .env，生成一份（密钥随机，端口 3000）"
  umask 077
  PG_PASSWORD="$(openssl rand -hex 16)"
  # 去掉 base64 里的 + / = ，避免拼进 DATABASE_URL 时被当成特殊字符
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64)"
  cat > .env <<EOF
# 由 deploy/remote-up.sh 首次生成。改完需要 docker compose up -d 让 app 重建。
PG_USER=youdee
PG_PASSWORD=$PG_PASSWORD
PG_DB=youdee
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_TTL_MIN=15
JWT_REFRESH_TTL_DAYS=7
APP_PORT=${APP_PORT:-3000}
MAX_UPLOAD_BYTES=5242880
SEED_ON_BOOT=1
EOF
  echo "[up] .env 已生成（口令不要外传，它同时在数据库与连接串里）"
else
  echo "[up] 复用已有 .env"
fi

# shellcheck disable=SC1091
APP_PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2)"
APP_PORT="${APP_PORT:-3000}"

echo "[up] 构建镜像（首次 3-6 分钟：npm ci + next build）"
$DC up -d --build

echo "[up] 等待健康检查"
i=0
while [ $i -lt 60 ]; do
  i=$((i + 1))
  if $DC ps --status running --services 2>/dev/null | grep -qx app; then
    # /health 在库断掉时也返回 200，所以必须看 data.db 字段
    if $DC exec -T app node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>r.json()).then(d=>process.exit(d?.data?.db==='ok'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "[up] 服务已就绪：http://<服务器IP>:$APP_PORT"
      $DC ps
      exit 0
    fi
  fi
  sleep 2
done

echo "[up] 120 秒内没等到健康，最近日志：" >&2
$DC logs --tail 60 app >&2
exit 1
