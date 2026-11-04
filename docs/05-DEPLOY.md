# 05 · 部署到远端 Linux

本文面向**执行部署的人**，假设你拿到一个源码压缩包和一台 Linux 服务器，不熟悉这个项目。
两条路径任选一条；不确定就选 A（Docker），失败面最小。

---

## 0. 包里有什么

```
youdee-0.1.0-YYYYMMDD.tar.gz
├── src/                 应用源码（前端页面 + API）
├── prisma/              数据库 schema、迁移 SQL、种子数据
├── public/              静态资源（构建期就固定的那些）
├── design-system/       设计 token（构建时被 import，不能删）
├── docs/                PRD / 架构 / UIUX / 本文档
├── deploy/
│   ├── deploy.sh        本机 → 远端一键（需能 ssh 到服务器）
│   ├── bootstrap.sh     远端装 Docker（只需一次）
│   ├── remote-up.sh     构建并启动（Docker 路径）
│   ├── manual-deploy.sh 构建并启动（裸机路径，不用 Docker）
│   ├── verify.mjs       部署后自检（能否登录、比价、出单、导出、权限）
│   ├── youdee.service   systemd 单元（裸机路径）
│   ├── entrypoint.sh    容器启动序列（等库→迁移→种子→起服务）
│   ├── wait-db.mjs      等数据库可连
│   └── env.example      环境变量模板
├── package.json / package-lock.json
├── Dockerfile / docker-compose.yml / .dockerignore
└── next.config.ts / tsconfig.json / postcss.config.mjs / prisma.config.ts
```

包里**不含** `node_modules`、`.next`、`.env`。这三样都要在目标机上重新生成 ——
尤其 `node_modules` 不能从开发机拷：`sharp`、`pg` 是平台相关二进制，Windows 上装的那份到 Linux
上会在"上传图片"或"连数据库"时才崩，那时很难联想到是这个原因。

---

## 1. 服务器要求

| 项 | 最低 | 说明 |
|---|---|---|
| CPU / 内存 | 2 核 / 2 GB | 构建阶段吃内存，1 GB 机器容易在 `next build` 被 OOM killer 杀掉 |
| 磁盘 | 10 GB | 镜像 + node_modules + 数据库 |
| 系统 | 任意 x86_64 Linux | 已在 Debian/Ubuntu、RHEL 系上验证脚本 |
| 软件 | Docker 23+ 与 compose 插件 | 路径 A 需要；路径 B 只要 Node 20.19+ 与 PostgreSQL 14+ |
| 网络 | 能访问 npm registry | 构建要装依赖。**纯离线机器见 §6** |

防火墙放行对外端口（默认 3000）。如果走 Nginx 反代，只对内网开放 3000。

---

## 2. 路径 A：Docker Compose（推荐）

### 2.1 上传并解包

在**你的电脑**上（包里已带脚本，一条命令搞定）：

```bash
tar -xzf youdee-0.1.0-YYYYMMDD.tar.gz -C youdee-src
cd youdee-src
deploy/deploy.sh root@1.2.3.4          # 口令登录：SSH_PASS='密码' deploy/deploy.sh root@1.2.3.4
```

脚本会做：打包源码 → scp 到服务器 `/opt/youdee` → 缺 Docker 就先装 → 构建镜像 → 起服务 → 等健康检查。
看到 `服务已就绪` 即成功。

如果服务器不能直连、只能手动传文件，那就用 `scp` 传包上去，然后在**服务器**上：

```bash
mkdir -p /opt/youdee && tar -xzf youdee-0.1.0-YYYYMMDD.tar.gz -C /opt/youdee
cd /opt/youdee && chmod +x deploy/*.sh
```

### 2.2 配置

首次执行 `remote-up.sh` 会自动生成 `.env`（随机口令与密钥）。要自定义就**先**手动建：

```bash
cd /opt/youdee
cp deploy/env.example .env
vi .env                      # 至少改 PG_PASSWORD 与 JWT_SECRET
chmod 600 .env
```

三个必须注意的点：

- `JWT_SECRET` 换成随机长串。用模板占位值上线 = 任何人都能伪造登录态。
  生成：`openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64`
- `PG_PASSWORD` **只用字母数字**。它会被拼进 `DATABASE_URL`，含 `@ : / ? #` 会让连接串错位，
  报错是 `getaddrinfo ENOTFOUND`，看着像网络问题其实不是。
- `APP_PORT` 改的是对外端口，容器内始终 3000。

### 2.3 启动

```bash
cd /opt/youdee
sh deploy/bootstrap.sh        # 只在没装 Docker 时需要，装完重登使 docker 组生效
sh deploy/remote-up.sh
```

首次构建 3–6 分钟（`npm ci` + `next build`）。之后改代码再跑同一条命令，依赖层命中缓存会快很多。

### 2.4 日常运维

```bash
cd /opt/youdee
docker compose ps                 # 状态
docker compose logs -f app        # 应用日志
docker compose restart app        # 重启（不重建）
docker compose down               # 停掉（数据在卷里，不丢）
docker compose up -d --build      # 更新到新代码
docker compose exec db psql -U youdee -d youdee    # 进库
```

两个卷：`youdee_dbdata`（数据库）、`youdee_uploads`（附件）。
**删卷等于删库删附件**，`docker compose down -v` 不要随手敲。

---

## 3. 路径 B：裸机（不用 Docker）

前提：Node.js ≥ 20.19、PostgreSQL ≥ 14 已装好，并且已建好库与用户：

```bash
sudo -u postgres psql <<'SQL'
CREATE USER youdee WITH PASSWORD '改成随机字母数字串';
CREATE DATABASE youdee OWNER youdee;
SQL
```

然后：

```bash
sudo mkdir -p /opt/youdee && sudo chown $USER /opt/youdee
tar -xzf youdee-0.1.0-YYYYMMDD.tar.gz -C /opt/youdee
cd /opt/youdee
cp deploy/env.example .env
vi .env      # DATABASE_URL 改成 postgresql://youdee:口令@127.0.0.1:5432/youdee?schema=public
chmod 600 .env

sh deploy/manual-deploy.sh
```

脚本会依次做：装依赖 → 生成 Prisma 客户端 → 构建 → 应用迁移 → 灌种子。
`DATABASE_URL` 没填好时它会停下并提示，不会带着错配置继续。

启动交给 systemd：

```bash
sudo useradd -r -s /sbin/nologin youdee
sudo chown -R youdee:youdee /opt/youdee
sudo cp deploy/youdee.service /etc/systemd/system/youdee.service
sudo systemctl daemon-reload
sudo systemctl enable --now youdee
sudo systemctl status youdee        # 看是否 active (running)
journalctl -u youdee -f             # 看日志
```

不想用 systemd 就前台试跑，日志直接打在终端：

```bash
cd /opt/youdee && npx next start -H 0.0.0.0 -p 3000
```

---

## 4. 部署后必做：跑自检

```bash
cd /opt/youdee
node deploy/verify.mjs                                  # 默认打 http://127.0.0.1:3000
BASE_URL=http://1.2.3.4:3000 node deploy/verify.mjs      # 或打对外地址
```

它会走完整条链路（登录 → 主体库 → 比价 → 取价 → 建单 → 加行 → 自检 → 出单 → 导出 → 权限 → 约束），
每项都对比**具体数值**，不是"有响应就算过"：

```
[通过] 健康检查 — db=ok
[通过] 管理员登录 — 管理员
[通过] 物料库已初始化 — material 共 15 条
[通过] 比价命中 1 组 — custom_made / 非时间 / 可比 2/5
[通过] 不可比的行没有被隐藏 — 返回 5 行
[通过] 标出了最低价 — 本公司自有 归一价 80.5562
[通过] 比价价 = 取价价（同一价同一个数） — 比价 80.5562 / 取价 80.5562
[通过] 新建报价单 — YD-202611-002
[通过] 加行：从价格库取成本
[通过] 加行：手填成本
[通过] 自检：手填成本给出提醒 — R2_MANUAL_COST
[通过] 自检：不因警告而拦截出单 — blocked=false
[通过] 出单 — issued
[通过] 导出客户版 — 7406 字节 / application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
[通过] 管理员可导出内部版 — 200
[通过] 成员登录 — 小王
[通过] 成员改旧价被拒绝（40301） — 40301 修改已有价格需要管理员权限…
[通过] 区间重叠被拦（40902） — 40902 …
[通过] 错误响应不含数据库术语 — 干净

合计 20 项，通过 20，失败 0
```

**为什么不能只看"网页能打开"**：这个系统最危险的缺陷全都不报错，只是数字不对 ——
金额标度差 100 倍、含税口径不同却被算成可比、成员能改别人的历史价。
页面照样渲染，只是结论是错的。这 13 项就是针对这类缺陷写的。

自检会留下 1 张客户名为「自检样例」的已发出报价单，测试完按需作废。

---

## 5. 常用操作

**改配置**：改 `.env` 后 `docker compose up -d`（Docker）或 `systemctl restart youdee`（裸机）。

**改默认账号密码**：首次登录后到「设置 → 账号」改。种子账号是
`admin` / `xiaowang`，初始口令都是 `youdee2026`，**上线前必须改掉**。

**备份**：

```bash
# Docker
docker compose exec -T db pg_dump -U youdee youdee | gzip > backup-$(date +%F).sql.gz
docker run --rm -v youdee_uploads:/u -v "$PWD":/b alpine tar czf /b/uploads-$(date +%F).tar.gz -C /u .

# 裸机
pg_dump -U youdee youdee | gzip > backup-$(date +%F).sql.gz
tar czf uploads-$(date +%F).tar.gz -C /opt/youdee var/uploads
```

**恢复**：`gunzip -c backup.sql.gz | docker compose exec -T db psql -U youdee -d youdee`

---

## 6. 常见故障对照

| 现象 | 原因 | 处理 |
|---|---|---|
| 容器起来又退出，日志停在 `等待数据库就绪` | 库没起来或密码错 | `docker compose logs db`；核对 `.env` 的 `PG_PASSWORD` 与卷里旧密码是否一致（改过密码但没删卷会认证失败） |
| `getaddrinfo ENOTFOUND` / 连接串解析失败 | `PG_PASSWORD` 里有 `@ : / ? #` | 换成纯字母数字口令，重建卷 |
| `npm ci` 报 EACCES / 路径不存在 | 仓库里的 `.npmrc` 写死了开发机的 Windows 缓存路径 | 该文件已被 `.dockerignore` 排除；裸机路径下请删除或注释 `.npmrc` 里的 `cache=` |
| 构建被 Killed | 内存不足（1 GB 机器常见） | 加 swap 或换 2 GB 机器；`NODE_OPTIONS=--max-old-space-size=1536` |
| 页面能开，登录报 500 | 迁移没跑或库连不上 | `docker compose logs app` 看首个报错；确认 `prisma migrate deploy` 有输出 |
| 上传图片后刷新 404 | `var/uploads` 没挂卷，或目录权限不对 | 确认 compose 里有 `uploads` 卷；容器内目录属主应为 `app`(10001) |
| 端口占用 | 3000 被别的东西占了 | `.env` 里改 `APP_PORT=8080` |
| 中文乱码 | 库编码不是 UTF8 | 建库时指定 `ENCODING 'UTF8'`；本项目的迁移含中文默认值与注释 |
| `prisma migrate deploy` 报 P3025 | 配置里设了 `shadowDatabaseUrl` 且与主库相同 | 本项目 `prisma.config.ts` 已移除该字段，不要加回去 |

**纯离线服务器**：Docker 路径下在没有外网的机器上 `docker build` 会失败。两种做法：
① 在一台能联网的**同架构 Linux** 上 `docker compose build`，再 `docker save youdee-app | gzip > img.tar.gz`，
拷到目标机 `docker load`，然后 `docker compose up -d`（跳过 `--build`）；
② 用路径 B，把 `node_modules` 与 `.next` 一起打包过去（必须在 Linux 上装，不能从 Windows 拷）。

---

## 7. 这个包里没有的东西

如实列出，免得等上线才发现：

- **HTTPS / 域名**：只提供 HTTP。要对外网开放请在前面加 Nginx 或 Caddy 做 TLS，本项目不做跳转与证书管理。
- **档期日历**：人员比价页原设计的 30 天档期格没有数据源，界面上是一段说明而不是空方块。
- **客户版 PDF**：只能走浏览器打印，没有服务端 PDF 渲染。
- **多租户 / 权限细分**：只有 `admin` 与 `member` 两级，够 3–10 人共用，不适合对外 SaaS。
- **自动备份**：上面的备份命令要自己配 cron。

---

## 8. 回滚

代码层：`git` 不在包里，回滚靠重新上传上一版压缩包，然后 `docker compose up -d --build` / 重跑 `manual-deploy.sh`。

数据库层：迁移是**前进式**的，本项目没有 down 脚本。回滚代码前先备份库；
如果新版迁移改了表结构，旧代码可能读不了新结构，此时用部署前的 `pg_dump` 恢复。
