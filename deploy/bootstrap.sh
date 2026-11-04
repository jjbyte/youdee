#!/usr/bin/env sh
# 远端一次性环境准备：Docker + compose 插件。只需跑一次。
# 支持 Debian/Ubuntu 与 RHEL 系（CentOS / Rocky / Alma / TencentOS / openEuler）。
set -eu

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "[bootstrap] Docker 与 compose 已就绪，无需安装"
  docker --version
  docker compose version
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "[bootstrap] 需要 root 权限：sudo sh $0" >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  echo "[bootstrap] 使用 apt 安装"
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc 2>/dev/null \
      || curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif command -v dnf >/dev/null 2>&1; then
  echo "[bootstrap] 使用 dnf 安装"
  dnf install -y dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif command -v yum >/dev/null 2>&1; then
  echo "[bootstrap] 使用 yum 安装"
  yum install -y yum-utils
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "[bootstrap] 认不出包管理器，请手动装 Docker 与 compose 插件" >&2
  exit 1
fi

# 国内机器经常连不上 download.docker.com，失败时给一条明确的替代路径
systemctl enable --now docker || echo "[bootstrap] 启动 docker 失败，可能需要手动 systemctl start docker" >&2

echo "[bootstrap] 完成"
docker --version
docker compose version
