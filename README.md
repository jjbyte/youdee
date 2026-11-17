# 有底 · 活动物料与人员价格库 + 报价单

面向活动策划公司的内部系统。把「同一个物料、同一个岗位，各家供应商报多少钱」记成可查、可比、可出稿的底账，并按项目类型算清毛利、一键出客户版报价单。

当前版本 **0.1.42** ｜ Next.js 16 + React 19 + TypeScript + PostgreSQL 18 ｜ 单机部署，3–10 人共用

---

## 目录

- [一、系统功能介绍](#一系统功能介绍)
- [二、系统架构](#二系统架构)
- [三、文件结构](#三文件结构)
- [四、部署方式](#四部署方式)

---

## 一、系统功能介绍

### 1.1 解决什么问题

活动公司的报价员每天要回答：一个「桁架背景板 6m×3m」，A 家 120 元/㎡、B 家 95 元/㎡ 但不含税、C 家按「根」报 380 元，到底用哪家。这些价格过去散在微信群和几个人记忆里，导致每次报价都要重问、改过价没人记得旧价、谁更便宜只能靠印象。

系统把这件事拆成两半：

1. **价格底账**：每个物料 / 每个岗位的价格，按「供应商 × 交易性质 × 含税口径 × 计价单位 × 生效期间」记下来，改价留痕、旧价不丢；
2. **对外报价单**：按项目类型算毛利，比价时摆出「谁更便宜、便宜多少、为什么这家不能用」，一键出客户版 Excel / 打印稿。

### 1.2 功能模块

登录后有 13 个页面，其中合同管理与发票台账整块只对管理员开放。

| 模块 | 路由 | 功能 |
|---|---|---|
| 总览 | `/` | 本周单量、毛利分布、临期价格、待办提醒（含周期性合同一个月内到期） |
| 合同管理（管理员） | `/contracts` | 合同台账（商业 / 租赁 / 雇佣三类）；三类附件（合同 / 报价单 / 结算），可存本地或腾讯云 COS，支持在线预览；按编号、名称、甲乙方、分类、签订日期、终止日期、创建日期查；状态手工维护（签订中 / 履约中 / 结算中 / 已结算 / 已终止）；填了终止日期的算周期性合同，列表显示「还剩 N 天」，30 天内到期标红并排最前；可关联发票 |
| 发票台账（管理员） | `/invoices` | 按号码、购买方、销售方、开票日期、状态、是否挂合同查；列表头给出张数 / 金额和 / 税额和 / 待补金额张数；批量上传 PDF·OFD·JPG·PNG 自动识别入库；批量下载查询结果为 ZIP；状态三选一：正常 / 已冲红 / 红字票（互斥）；原件可在线预览 |
| 报价单列表 | `/quotes` | 全部状态（草稿 / 已发出 / 已作废），草稿优先 |
| 报价单编辑 | `/quotes/:id/edit` | 逐行录明细、毛利率反算、风险检查、出单 |
| 客户版预览 | `/quotes/:id/preview` | 打印 / PDF / 客户版 Excel 的纸面 |
| 物料库 | `/materials` | 物料档案、搜索、归档 |
| 物料比价 | `/materials/:id` | 该物料全部供应商报价、归一价排序、价格趋势 |
| 人员库 | `/staff`、`/staff/:id` | 同上，按「场 / 天 / 小时」计价 |
| 供应商库 | `/vendors` | 联系方式、开票信息、结算方式 |
| 客户 / 项目 | `/guests` | 往来客户与历史项目 |
| 设置 | `/settings` | 公司抬头、报价默认值（税口径 / 默认毛利率 / 预警线 / 有效期）、报价单模板（可上传 Excel）、对象存储、发票识别（腾讯云 OCR）、账号管理 |

### 1.3 角色与权限

只有两级权限。

| 角色 | 种子账号 | 权限 |
|---|---|---|
| 管理员 admin | `admin` / `youdee2026` | 全部功能；合同管理、发票台账；改已有档案与价格；删除；导出内部版（带成本） |
| 成员 member | `xiaowang` / `youdee2026` | 查价比价、做报价单、**新建**物料 / 人员 / 供应商 / 报价、录价、作废与恢复、导出客户版；不能改已有档案与价格、不能删除、看不到合同与发票 |

> 两个初始口令上线前必须改掉（设置 → 账号）。

### 1.4 核心业务规则

| # | 规则 | 实现要点 |
|---|---|---|
| 1 | 改价 = 新增一条 + 关闭旧价，永不覆盖 | 价格带生效期间；数据库 `EXCLUDE USING gist` 六维约束防止重叠 |
| 2 | 含税价与不含税价不混排 | 单据声明一个口径；异口径供应商照常显示但标灰，写明不参与排序 |
| 3 | 按场与按天不混排 | 按计价口径分组，各组各算最低价 |
| 4 | 跨单位比价靠折算系数 | 未填「1㎡ = 几张」就标「不可比」，不假设 1:1 |
| 5 | 毛利低于预警线只提醒，不拦出单 | 预警线按项目类型分；只有「客户名空 / 活动名空 / 有行没成本」拦出单 |
| 6 | 报价单是全量快照 | 存当时的名称、规格、单位、成本、对客价，历史单不随涨价变化 |
| 7 | 合同有终止日期即为周期性合同 | 不另设周期枚举；30 天窗口单点定义 `CONTRACT_EXPIRING_WINDOW_DAYS`；列表按「已到期 / 30 天内」→「其它有终止日期」→「无终止日期」三段排序 |
| 8 | 红字票与「已冲红」是两件事 | `is_red_letter` 决定三项金额符号；`status`（正常 / 已冲红）只是标签，改它不动金额；界面状态由 `is_red_letter` 派生为「红字票」，两者互斥 |
| 9 | 发票判重按「代码 + 号码」，代码为空时按号码放宽 | 唯一键 `(invoice_code, invoice_no)`；任一侧代码为空即视为同一张 |
| 10 | 发票三项金额可空，空不等于 0 | 未识别的留 NULL；三项互校容差 1 分，超出标黄但照样入库 |

---

## 二、系统架构

### 2.1 技术栈

| 层 | 选型 | 版本 | 用途 |
|---|---|---|---|
| 前端框架 | Next.js（App Router） | 16.4.5 | 页面与接口同仓库、同进程 |
| UI | React + Tailwind CSS | 19.3.1 / 4.3.4 | 组件与设计 token（`design-system/`） |
| 语言 | TypeScript | 5.9.3 | 金额、单位、口径靠类型兜住 |
| 数据请求 | TanStack Query / Table | 5.105.3 / 8.21.3 | 列表缓存、排序、筛选 |
| 数据库 | PostgreSQL | 18 | `EXCLUDE` 约束、生成列、`gin_trgm` 模糊搜索 |
| 数据访问 | Prisma + `@prisma/adapter-pg` | 7.10.1 | 迁移管理、类型生成；查询走 `pg` 连接池 |
| 校验 | zod | 4.6.7 | 请求体与查询参数 |
| 认证 | jose（JWT + HttpOnly Cookie） | 6.2.15 | access 15 分钟、refresh 7 天 |
| 导出 | exceljs | 4.4.0 | 客户版 / 内部版 Excel |
| 图表 | recharts | 3.10.1 | 价格趋势、毛利分布 |
| 发票识别 | tencentcloud-sdk-nodejs-ocr | 4.1.344 | `RecognizeGeneralInvoice` |
| 批量打包 | yazl | 3.3.1 | ZIP 流式输出，内存恒定 |

### 2.2 分层与请求链路

```
浏览器
  │
  ├─ 页面  src/app/(app)/**/page.tsx  ── React 组件  src/components/**
  │
  ▼  fetch /api/v1/...
Route Handler  src/app/api/v1/**/route.ts
  │   wrap.ts：统一鉴权、错误翻译、响应封装
  ▼
Service  src/server/services/**      业务编排、事务、SQL 执行
  │      store/：prices / quotes / settings 的 SQL
  ▼
Domain  src/domain/**                纯函数：算价、比价、校验、状态机、口径判定
  │
  ▼
pg 连接池（src/server/db.ts） → PostgreSQL 18
                             → 本地磁盘 var/uploads 或 腾讯云 COS
                             → 腾讯云 OCR（仅发票识别）
```

分层是单向的：`app/api → services → store → db`；`domain` 可被任意层调用，自身不依赖数据库、HTTP 或 SDK（因此可单测）。

### 2.3 数据模型

24 张表，按业务域分组：

| 域 | 表 |
|---|---|
| 账号与配置 | `User` `AppSetting` `Counter` `MarginThreshold` |
| 主数据 | `Unit` `Supplier` `Category` `Item` `ItemImage` `ItemLink` |
| 价格 | `Price` `PriceTier` `PriceAttachment` `PriceChangeLog` |
| 报价单 | `Quote` `QuoteItem` `QuoteTemplate` |
| 合同 | `Contract` `ContractFile` `ContractQuote` `ContractInvoice` |
| 发票 | `Invoice` `InvoiceFile` |
| 通知 | `Notification` |

- `Item` 用 `kind` 区分物料与人员，两者共用比价逻辑。
- `Price` 的六维唯一性由 `EXCLUDE` 约束保证（主体 + 供应商 + 交易性质 + 含税口径 + 计价口径 + 生效期间）。
- `ContractInvoice` 是合同与发票的多对多中间表，合同抽屉与发票抽屉读写同一张表。
- 软删统一用 `deleted_at`；`Notification` 承载工作台待办。

### 2.4 存储与外部依赖

| 依赖 | 必需 | 说明 |
|---|---|---|
| PostgreSQL 18 | 是 | 生产用 `postgres:18-alpine`；本地开发用 embedded-postgres（端口 55432） |
| 本地磁盘 `UPLOAD_DIR` | 是 | 默认 `var/uploads`，容器部署必须挂卷 |
| 腾讯云 COS | 否 | 合同附件可选云存储，密钥在「设置 → 对象存储」填，按行记录实际存储位置 |
| 腾讯云 OCR | 否 | 发票识别；密钥在「设置 → 发票识别」填，未配置时只能手工录入 |

无 Redis、无消息队列、无第三方 SaaS 账号体系。

### 2.5 关键工程约束

- **金额**一律用定点小数（`numeric` + 字符串传输），不经过 JS 浮点。
- **列表与统计同一条 SQL**：`count(*) FILTER (...)` 与 `SUM(...) OVER ()` 跟 `items` 一起出，避免两次查询之间数据变化导致合计对不上。
- **写接口统一校验**：服务端 `domain` 层是唯一校验点，手工录入、编辑、OCR 入库三条路径共用。
- **附件读取按行分流**：`contract_files.storage` 记录 `local` / `cos`，切换存储不迁移历史文件。
- **构建产物不入库**：`node_modules`、`.next`、`.env`、上传附件都不进交付包。

规模：**24 张表 / 13 个迁移 / 89 个接口路由 / 13 个业务页面 / 373 条单测 / 143 项部署自检**。

---

## 三、文件结构

```
youdee/
├── src/
│   ├── app/
│   │   ├── (app)/                  # 登录后业务页（共用侧边栏布局）
│   │   │   ├── page.tsx            # 总览
│   │   │   ├── contracts/          # 合同台账
│   │   │   ├── invoices/           # 发票台账
│   │   │   ├── quotes/             # 列表 / [id]/edit 编辑 / [id]/preview 客户版
│   │   │   ├── materials/          # 物料库 / [id] 比价
│   │   │   ├── staff/              # 人员库 / [id]
│   │   │   ├── vendors/            # 供应商库
│   │   │   ├── guests/             # 客户 / 项目
│   │   │   └── settings/           # 设置
│   │   ├── login/                  # 登录页
│   │   ├── api/v1/                 # 89 个 route.ts，REST 接口
│   │   ├── uploads/[...path]/      # 本地附件读取
│   │   └── globals.css             # 全局样式与 .paper-* 纸面样式
│   ├── components/
│   │   ├── quote/                  # 明细表、单头、客户版纸面
│   │   ├── invoices/               # 筛选、统计卡、列表、上传、抽屉、原件预览
│   │   ├── contracts/              # 合同抽屉、附件、发票关联
│   │   ├── compare/                # 比价表、价格趋势
│   │   ├── staff/ vendors/ settings/
│   │   └── ui/                     # Button / Input / Select / Drawer / Table / PdfPreview
│   ├── domain/                     # 纯函数（17 个）：算价、比价、校验、发票映射、权限
│   ├── server/
│   │   ├── db.ts                   # pg 连接池单例
│   │   ├── http.ts                 # 错误翻译、断言、响应
│   │   ├── wrap.ts                 # 路由包装与统一异常处理
│   │   ├── auth/                   # JWT、口令哈希、会话 Cookie
│   │   ├── services/               # 业务服务（50 个）：quote / price / contract / invoice / export …
│   │   └── store/                  # SQL：prices / quotes / settings
│   └── lib/                        # 前端共用：api 客户端、类型、格式化、文案表
├── prisma/
│   ├── schema.prisma               # 24 张表
│   ├── migrations/                 # 13 个手写迁移（EXCLUDE / 生成列 / 触发器）
│   └── seed.ts                     # 种子数据（幂等，已有用户即跳过）
├── tests/                          # 22 个文件 / 373 条单测（纯函数，不连库）
├── deploy/                         # 部署脚本、自检、systemd 单元、环境变量模板
├── design-system/                  # 设计 token（CSS + JSON）
├── docs/specs/                     # 发票模块规格书
├── scripts/db.mjs                  # 本地数据库启停（embedded-postgres）
├── public/                         # 构建期静态资源
├── Dockerfile
├── docker-compose.yml
├── next.config.ts
├── prisma.config.ts
└── package.json                    # 依赖版本逐个锁定
```

### 改动定位

| 要改什么 | 改哪里 | 影响面 |
|---|---|---|
| 客户版列顺序 / 表头 / 格子内容 | `src/domain/customer-sheet.ts` | 打印页、PDF、客户版 Excel（三处同源） |
| 纸面样式 | `src/app/globals.css` 的 `.paper-*` | 打印与屏幕预览 |
| 金额计算、毛利反算 | `src/domain/money.ts`、`quote-calc.ts` | 报价单、比价、导出 |
| 接口报错文案 | `src/server/http.ts` | 全部接口 |
| 主题色、间距、字号 | `design-system/design-tokens.css` | 全站 |
| 默认税口径 / 毛利率 / 预警线 | 数据库 `app_settings`（设置页） | 建单、比价、预警 |
| 合同字段与校验 | `src/domain/contract.ts` | 新建与编辑两条路径 |
| 发票字段 / 判重 / 容差 / 冲红 | `src/domain/invoice-record.ts`、`invoice-money.ts` | 手工录入、编辑、OCR 入库 |
| OCR 字段映射 | `src/domain/invoice-ocr.ts` | 仅识别入库 |
| 附件类型白名单 | `src/server/services/file-type.ts` | 合同附件三个上传口 |

---

## 四、部署方式

### 4.1 环境要求

| 项 | 要求 |
|---|---|
| Node.js | `>= 20.19`，建议 22 LTS |
| PostgreSQL | 生产 18（`postgres:18-alpine`），裸机 `>= 14` |
| Docker | 仅 Compose 路径需要（引擎 + compose 插件） |
| 内存 / 磁盘 | 1 GB 内存起；附件按实际用量，建议单独挂盘 |

### 4.2 环境变量

生产模板见 `deploy/env.example`，开发模板见根目录 `.env.example`。

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | — | `postgresql://用户:口令@主机:5432/库?schema=public` |
| `JWT_SECRET` | 是 | — | 32 字节以上随机串；用占位值上线等于任何人都能伪造登录态 |
| `PORT` | 否 | 3000 | 监听端口 |
| `UPLOAD_DIR` | 否 | `var/uploads` | 附件目录，容器部署必须挂卷 |
| `MAX_UPLOAD_BYTES` | 否 | 5242880 | 图片等普通上传上限（5 MB） |
| `MAX_CONTRACT_FILE_BYTES` | 否 | 0 | 合同附件单份上限，0 = 不限（流式上传） |
| `PREVIEW_MAX_BYTES` | 否 | 33554432 | 在线预览体积上限（32 MB） |
| `JWT_ACCESS_TTL_MIN` / `JWT_REFRESH_TTL_DAYS` | 否 | 15 / 7 | 登录态时长 |
| `COOKIE_SECURE` | 否 | 自动 | 留空按请求协议判断；HTTPS 终结在代理且未传 `X-Forwarded-Proto` 时设 `1` |
| `NODE_ENV` | 生产 | — | 运行时必须是 `production` |

Docker Compose 额外使用：`PG_USER` `PG_PASSWORD` `PG_DB` `APP_PORT` `SEED_ON_BOOT` `NPM_REGISTRY`。

生成密钥：

```bash
openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64
```

### 4.3 方式 A：本地开发

```bash
# 1. 依赖
node -v                 # 需 >= 20.19
npm ci

# 2. 环境变量
cp .env.example .env
# 把 JWT_SECRET 换成随机串；DATABASE_URL 默认指向本地 55432

# 3. 起数据库（占用一个终端，Ctrl+C 停止）
npm run db:start

# 4. 建表 + 灌种子（另开一个终端）
npm run db:migrate
npm run db:seed

# 5. 起开发服务器
npm run dev             # http://localhost:3000
```

登录 `admin / youdee2026`（管理员）或 `xiaowang / youdee2026`（成员）。

常用命令：

```bash
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run build           # 生产构建（构建前先停 dev server）
npm run db:status       # 本地库连通性
npm run db:migrate:dev  # 改完 schema 后生成并应用迁移
npm run db:reset        # 清库重建（会丢数据）
```

### 4.4 方式 B：Docker Compose（生产推荐）

**① 本地打包**

```bash
bash deploy/pack.sh
# 产物：dist/youdee-<版本>-<日期>.tar.gz 与同名 .sha256
```

**② 上传并校验**

```bash
scp dist/youdee-*.tar.gz dist/youdee-*.sha256 root@<服务器>:/tmp/
# 服务器上
cd /tmp && sha256sum -c youdee-*.tar.gz.sha256
```

**③ 解包并配置**

```bash
mkdir -p /opt/youdee
tar -xzf /tmp/youdee-*.tar.gz -C /opt/youdee
cd /opt/youdee
chmod +x deploy/*.sh
cp deploy/env.example .env
```

`.env` 里至少要改三处：`JWT_SECRET`（随机串）、`PG_PASSWORD`（只用字母数字）、`APP_PORT`（对外端口）。

**④ 装 Docker（未装过才需要）**

```bash
sudo sh deploy/bootstrap.sh
```

**⑤ 构建并启动**

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

容器启动序列为：等库 → `prisma migrate deploy` → 种子（`SEED_ON_BOOT=1` 且空库时）→ `next start`。

**⑥ 自检**

```bash
node deploy/verify.mjs
```

也可用一键脚本（本地打包 → 上传 → 远端构建 → 等健康）：`bash deploy/deploy.sh root@1.2.3.4`。

### 4.5 方式 C：裸机 Node + PostgreSQL（不能装 Docker 时）

**① 装环境**

```bash
# Node 22（Debian / Ubuntu）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER youdee WITH PASSWORD '你的口令';"
sudo -u postgres psql -c "CREATE DATABASE youdee OWNER youdee;"
```

**② 解包并写 `.env`**

```bash
sudo mkdir -p /opt/youdee
sudo tar -xzf /tmp/youdee-*.tar.gz -C /opt/youdee
cd /opt/youdee
sudo chmod +x deploy/*.sh
sudo cp deploy/env.example .env
sudo vi .env     # 改 DATABASE_URL（主机填 127.0.0.1）、JWT_SECRET、PORT
```

**③ 安装、迁移、构建**

```bash
sudo sh deploy/manual-deploy.sh
```

脚本会校验 Node 版本与当前目录是否就是线上目录，然后 `npm ci` → `prisma generate` → `migrate deploy` → `next build`。

**④ 交给 systemd**

```bash
sudo useradd -r -s /sbin/nologin youdee || true
sudo chown -R youdee:youdee /opt/youdee
sudo cp deploy/youdee.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now youdee
sudo systemctl status youdee
```

**⑤ 自检**

```bash
node deploy/verify.mjs
```

### 4.6 部署后自检

```bash
node deploy/verify.mjs                          # 默认 http://127.0.0.1:3000
BASE_URL=https://your.domain node deploy/verify.mjs
```

143 项，按业务链路走真实接口并逐项比对数值：登录、权限、比价、取价、建单、出单、导出、金额约束、发票识别与冲红、ZIP 打包、合同挂票与到期排序。

> 会写入数据：建一张客户名为「自检样例」的报价单并发出。跑完可在「报价单」里作废，不要当业务数据。

健康检查：`GET /api/v1/health`，返回 `status`、`db`、`version`、`build_id`、`cwd`、`uptime_s`。数据库不通时仍返回 200 且 `db=error`，用于区分「进程活着但库断了」和「进程崩了」。

部署脚本自身的逻辑自检（不需要 root、不启停服务、不碰库）：

```bash
bash deploy/test-deploy.sh      # 23 项
```

### 4.7 更新、备份、恢复

**更新（systemd 直装）**

```bash
# 本地
bash deploy/pack.sh
scp dist/youdee-*.tar.gz dist/youdee-*.sha256 root@<服务器>:/tmp/

# 服务器
cd /opt/youdee
sudo bash deploy/update.sh /tmp/youdee-<版本>-<日期>.tar.gz
```

`update.sh` 的顺序：备份库 / 附件 / `.env` → 解到旁目录 → 装依赖并构建（线上照常跑）→ 在 `PORT+1` 预启动自检 → 停服务 → 迁移 → 切换目录 → 起服务 → 校验版本。任一步失败自动回滚，线上不中断。

**更新（Docker）**

```bash
cd /opt/youdee
tar -xzf /tmp/youdee-*.tar.gz
docker compose up -d --build      # 容器启动时自动执行 migrate deploy
docker compose ps
```

`dbdata` 与 `uploads` 是命名卷，重建容器不丢数据；但**解包前确认 `.env` 还在**（包内不含 `.env`）。

**备份**

```bash
# 数据库（自定义格式，便于单表还原）
pg_dump -Fc "$DATABASE_URL" > /backup/youdee-$(date +%F).dump

# 附件
tar -czf /backup/uploads-$(date +%F).tar.gz -C /opt/youdee var/uploads

# Docker 部署（卷名 = 项目名_uploads，项目名默认取目录名，可用 docker volume ls 确认）
docker compose exec -T db pg_dump -Fc -U youdee youdee > /backup/youdee-$(date +%F).dump
docker run --rm -v youdee_uploads:/data -v /backup:/backup alpine tar -czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

备份命令不会自动执行，需要配 cron。

**恢复**

```bash
pg_restore -c --if-exists -d "$DATABASE_URL" /backup/youdee-2026-01-01.dump
tar -xzf /backup/uploads-2026-01-01.tar.gz -C /opt/youdee
sudo systemctl restart youdee
```

**排障**

```bash
cd /opt/youdee && sudo bash deploy/diagnose.sh
```

只读输出：systemd 单元真实配置、`/health` 原样返回、磁盘版本与进程 `cwd` 是否一致、端口监听者、最近日志。

### 4.8 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 密码正确、登录接口 200，随即提示登录已过期 | 页面是 http，却发了带 `Secure` 的 Cookie，浏览器静默丢弃 | 去掉 `COOKIE_SECURE`，或让代理传 `X-Forwarded-Proto` |
| `npm ci` 卡住或 `ETIMEDOUT` / `ECONNRESET` | 国内机器访问官方 registry 超时 | Compose 里设 `NPM_REGISTRY=https://registry.npmmirror.com` 后重建 |
| 重建容器后上传的附件全没了 | `uploads` 卷未挂载 | 检查 `docker-compose.yml` 的 volumes |
| 点发票原件「预览」变成下载文件 | 走的是 `raw`（302 到预签名地址），对象元数据为 `attachment` | 0.1.42 起预览走同源 `/content`；确认版本已更新 |
| 成员点新建报「需要管理员权限」 | 0.1.41 以前的权限口径 | 升级到 0.1.41+，成员可新建档案，改档 / 删档仍限管理员 |
| `/health` 里 `version` 与磁盘 `package.json` 不一致 | 进程跑的不是当前目录的产物 | 用 `deploy/diagnose.sh` 核对 `cwd` 与单元 `WorkingDirectory` |

---

## 附：许可与使用范围

内部工具，仅授权客户部署使用。上线前必须修改默认账号口令、替换 `JWT_SECRET`、配置 HTTPS。
