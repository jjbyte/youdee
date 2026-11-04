# syntax=docker/dockerfile:1
#
# 「有底」生产镜像。
#
# 刻意**不用** next 的 standalone 输出：本项目的运行期还依赖 prisma CLI（跑 migrate）
# 与 tsx（跑幂等种子）。standalone 只会把 next 运行需要的那几十个文件挑出来，
# 这两样一定缺，然后表现为"容器起来就退出，日志只说找不到模块"。
# 内部工具只部署一台机器，多两百兆换来"照着文档走一定跑得起来"，是值的。

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
# openssl 是 prisma 校验影子库/生成客户端要用的；curl 给 HEALTHCHECK 用
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl openssl \
 && rm -rf /var/lib/apt/lists/*

# ── 依赖层：只跟着 package.json 变，改业务代码不会重装 ──────────────
FROM base AS deps
WORKDIR /app
# 注意：不 COPY .npmrc。仓库里那份写的是本机 Windows 缓存路径
# （cache=C:/Users/...），进了 Linux 容器会让 npm 直接报 EACCES。
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 构建层 ────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建期给两个假的连接串：Next 在收集页面信息时会 import 到读 process.env 的模块，
# 变量为空会在 build 阶段抛错。这两个值只在 build 里存在，不进运行期镜像。
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    JWT_SECRET="build-time-placeholder-not-used-at-runtime"

RUN npx --no-install prisma generate && npx --no-install next build

# ── 运行层 ────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=var/uploads

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# src 只为让 prisma/seed.ts 能 import 到 hashPassword；不参与运行期请求处理
COPY --from=builder /app/src ./src
COPY package.json prisma.config.ts next.config.ts tsconfig.json ./
COPY deploy ./deploy

# 附件落在 var/uploads（不放 public/ 下：那是构建期静态资源目录，
# 运行期往里写文件会与静态托管抢路径）。compose 里把这个目录挂成卷。
# 先建好并交给非 root 用户，否则挂载后首次上传会 EACCES。
RUN mkdir -p var/uploads \
 && chmod +x deploy/*.sh \
 && useradd --create-home --uid 10001 app \
 && chown -R app:app /app

USER app
EXPOSE 3000

# 注意：/health 在库挂掉时也返回 200（status=ok, db=error），是有意的——
# 它区分"进程活着但库断了"和"进程崩了"。所以这里必须看 db 字段，不能只看 HTTP 码。
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>r.json()).then(d=>process.exit(d?.data?.db==='ok'?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./deploy/entrypoint.sh"]
