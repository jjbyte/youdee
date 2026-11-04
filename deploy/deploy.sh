#!/usr/bin/env bash
#
# 本机 → 远端 Linux 一键部署。
#
#   用法：deploy/deploy.sh root@1.2.3.4 [ssh端口] [远端目录]
#   口令登录：SSH_PASS='密码' deploy/deploy.sh root@1.2.3.4
#   指定端口：APP_PORT=8080 deploy/deploy.sh root@1.2.3.4
#
# 只传源码（tar 打包），远端构建镜像。不在本机构建再推镜像，
# 因为 Node 原生依赖（sharp / pg）在 Windows 与本机架构上编出来的产物
# 拿到 Linux 上是不能用的——这种错很难看出来：容器能起，一加载图片就崩。
set -euo pipefail

REMOTE="${1:?用法: deploy/deploy.sh user@host [ssh端口] [远端目录]}"
SSH_PORT="${2:-22}"
REMOTE_DIR="${3:-/opt/youdee}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=15)

if [ -n "${SSH_PASS:-}" ]; then
  command -v sshpass >/dev/null 2>&1 || {
    echo "设了 SSH_PASS 但本机没有 sshpass。装一个，或者改成密钥登录。" >&2
    exit 1
  }
  remote_sh() { sshpass -p "$SSH_PASS" ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }
  remote_put() { sshpass -p "$SSH_PASS" scp "${SSH_OPTS[@]/#-p/-P}" "$1" "$REMOTE:$2"; }
else
  remote_sh() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }
  remote_put() { scp "${SSH_OPTS[@]/#-p/-P}" "$1" "$REMOTE:$2"; }
fi

echo "[deploy] 目标 $REMOTE:$REMOTE_DIR（ssh 端口 $SSH_PORT）"

echo "[deploy] 检查远端连通性"
remote_sh 'echo "  ok $(hostname) $(uname -sr)"'

TARBALL="$(mktemp -t youdee-src-XXXXXX).tgz"
trap 'rm -f "$TARBALL"' EXIT

echo "[deploy] 打包源码"
tar -czf "$TARBALL" -C "$REPO_ROOT" \
  --exclude=./node_modules \
  --exclude=./.next \
  --exclude=./.git \
  --exclude=./pgdata \
  --exclude=./.pgtest \
  --exclude=./.workbuddy \
  --exclude=./public/uploads \
  --exclude=./var \
  --exclude='./*.log' \
  --exclude=./tsconfig.tsbuildinfo \
  --exclude=./.env \
  .
echo "[deploy] 包大小 $(du -h "$TARBALL" | cut -f1)"

REMOTE_TMP="/tmp/youdee-src-$$.tgz"
remote_put "$TARBALL" "$REMOTE_TMP"

echo "[deploy] 远端解包并构建（首次 3-6 分钟）"
remote_sh "set -eu
  if ! command -v docker >/dev/null 2>&1; then
    echo '[deploy] 远端没有 Docker，先装'; mkdir -p '$REMOTE_DIR'
  fi
  mkdir -p '$REMOTE_DIR'
  tar -xzf '$REMOTE_TMP' -C '$REMOTE_DIR'
  rm -f '$REMOTE_TMP'
  cd '$REMOTE_DIR'
  chmod +x deploy/*.sh
  if ! command -v docker >/dev/null 2>&1; then
    sh deploy/bootstrap.sh
  fi
  ${APP_PORT:+APP_PORT=$APP_PORT} sh deploy/remote-up.sh
"

HOST_ONLY="${REMOTE##*@}"
echo "[deploy] 完成。浏览器打开 http://${HOST_ONLY}:${APP_PORT:-3000}"
