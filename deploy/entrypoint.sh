#!/bin/sh
# 容器启动序列：等库 → 迁移 → 种子（幂等）→ 起服务。
# 用 sh 不用 bash：slim 镜像里没有 bash，写 #!/bin/bash 会 exec 失败，
# 而失败信息是 "no such file or directory"，很容易被误判成脚本路径错了。
set -eu

: "${DATABASE_URL:?DATABASE_URL 未设置}"

echo "[boot] 等待数据库就绪"
node deploy/wait-db.mjs

echo "[boot] 应用迁移"
npx --no-install prisma migrate deploy

# 种子脚本自己会判「已有用户就跳过」，所以每次启动都跑是安全的：
# 它只在空库上灌 17 单位 / 8 供应商 / 35 分类 / 25 主体 / 48 条价格。
# 关掉的话首次部署会得到一个能登录但什么都没有的库。
if [ "${SEED_ON_BOOT:-1}" = "1" ]; then
  echo "[boot] 检查种子数据"
  npx --no-install tsx prisma/seed.ts
fi

echo "[boot] 启动服务，端口 ${PORT:-3000}"
# exec 让 node 接管 PID 1，docker stop 的 SIGTERM 才收得到（否则等 10 秒被 SIGKILL）
exec npx --no-install next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
