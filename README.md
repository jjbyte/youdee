# 有底 · 活动物料与人员价格库 + 报价单

> 一句话：把散在微信群和几个人记忆里的「哪家多少钱」，变成能查、能比、能出稿的底账。

给活动策划公司用的内部工具。解决的核心问题只有一个：**同一个物料、同一个岗位，不同供应商报的价不一样，而这些价现在散在聊天记录和几个人的记忆里。**

---

## 目录

- [一、系统介绍](#一系统介绍)
  - [它解决什么问题](#它解决什么问题)
  - [谁能用、能做什么](#谁能用能做什么)
  - [六条「不出错」的设计](#六条不出错的设计)
  - [技术栈与规模](#技术栈与规模)
  - [明确不做的事](#明确不做的事)
- [二、文件结构](#二文件结构)
  - [顶层目录](#顶层目录)
  - [逐目录说明](#逐目录说明)
  - [几个「改了会影响哪里」的定位表](#几个改了会影响哪里的定位表)
- [三、部署方式](#三部署方式)
  - [先选路径](#先选路径)
  - [路径 A：本地跑起来（5 分钟）](#路径-a本地跑起来5-分钟)
  - [路径 B：Docker Compose（生产推荐，手把手）](#路径-bdocker-compose生产推荐手把手)
  - [路径 C：裸机 Node + PostgreSQL（不能装 Docker 时）](#路径-c裸机-node--postgresql不能装-docker-时)
  - [部署后必做：跑自检](#部署后必做跑自检)
  - [放到域名 / HTTPS 后面](#放到域名--https-后面)
  - [日常运维：更新、备份、恢复、回滚](#日常运维更新备份恢复回滚)
  - [常见故障对照](#常见故障对照)
- [四、常用命令](#四常用命令)
- [五、还缺客户提供的东西](#五还缺客户提供的东西)

---

## 一、系统介绍

### 它解决什么问题

活动公司的报价员每天在做一件很耗神的事：一个「桁架背景板 6m×3m」，A 家报 120 元/㎡、B 家报 95 元/㎡ 但只做不含税、C 家按「根」报 380 元，上个月还是另一个价。这些信息如果只在微信里，结果是：

- 每次报价都要重新问一遍，问的人不同、答案不同；
- 改过价之后，旧价没人记得，也没人能解释「上个月那张单为什么是 95」；
- 谁更便宜靠印象，便宜多少说不出来，为什么不用那家也说不出来。

系统把这件事拆成两半：

1. **价格底账**：每个物料、每个岗位的价格，按「供应商 × 交易性质 × 含税口径 × 计价单位 × 生效期间」记下来，改价留痕、旧价不丢；
2. **对外报价单**：按项目类型把毛利算清楚，比价时把「谁更便宜、便宜多少、为什么这家不能用」摆出来，一键出客户版 Excel / 打印稿。

### 谁能用、能做什么

只有两级权限，够 3–10 人共用：

| 角色 | 账号（种子） | 能做什么 |
|---|---|---|
| 管理员 | `admin` | 全部功能，含**改已有价格**、删主数据、导出内部版（带成本）|
| 成员 | `xiaowang` | 建价格、做报价单、导出客户版；**不能**改已有价格 |

> 两个账号初始口令都是 `youdee2026`，**上线前必须改掉**（设置 → 账号）。

登录后 12 个页面：

| 页面 | 路由 | 干什么 |
|---|---|---|
| 总览 | `/` | 本周单量、毛利分布、临期价格、待办提醒 |
| 报价单列表 | `/quotes` | 全部状态（草稿 / 已发出 / 已作废），默认草稿优先 |
| 报价单编辑 | `/quotes/:id/edit` | 明细逐行录入、毛利率反算、风险检查、出单 |
| 客户版预览 | `/quotes/:id/preview` | 打印 / PDF / 客户版 Excel 的纸面 |
| 物料库 | `/materials` | 物料档案、搜索、归档 |
| 物料比价 | `/materials/:id` | 该物料全部供应商报价、归一价排序、价格趋势 |
| 人员库 | `/staff` `/staff/:id` | 同上，按「场 / 天 / 小时」计价 |
| 供应商库 | `/vendors` | 联系方式、开票信息、结算方式 |
| 客户 / 项目 | `/guests` | 往来客户与历史项目 |
| 设置 | `/settings` | 公司抬头、报价默认值（税口径 / 默认毛利率 / 预警线 / 有效期天数）、报价单模板、账号管理 |

### 六条「不出错」的设计

这些点看起来像细节，但每一条背后都是一次会报错价的场景。

**1. 改价 = 新增一条 + 关闭旧价，永远不覆盖。**
价格记录带生效期间，数据库层用 `EXCLUDE USING gist` 六维约束保证「同一主体 + 同一供应商 + 同一交易性质 + 同一含税口径 + 同一计价口径 + 重叠期间」不可能同时存在两条。想改就直接改，拿到的是人话提示，不是数据库错误码。

**2. 含税价与不含税价不混排。**
一张单声明一个口径（默认含税）。不同口径的供应商**照样显示在页面上**，但标灰并写明「该供应商只报了不含税价，与本单口径不同，不参与排序」——而不是悄悄算进最低价里。这两者混算，结论会反。

**3. 按场和按天不混排。**
讲师「按场 2800」和「按天 1500」都属人员服务，但一场含几天不在价格里，本来不可比。系统按计价口径分组，各组各算各的最低价。LED 屏的买断价与租赁价同理。

**4. 跨单位比价靠折算系数，不靠猜。**
喷绘按㎡报价、淘宝按张卖，要能比必须有人填「1㎡ = 几张」。填了才参与排序，没填就标「不可比」并写明原因。系统**不会**替你假设 1:1 —— 那会把「我不知道」静默变成「我断言相等」。

**5. 毛利低于预警线只是提醒，不拦出单。**
预警线按项目类型分（年会 18% / 发布会 22% / 展台 25% / 路演 15% / 框架客户 12%）。有些单是故意亏的（走量、拿案例、维护关系），系统只把话说清楚，发不发由人决定。**唯一能拦住出单的是三件事：客户名空、活动名空、有行没有成本。**

**6. 报价单是全量快照。**
发出去的单里存的是当时的名称、规格、单位、成本、对客价、供应商名，不是价格的引用。三个月后供应商涨价、主体改名、价格被归档，历史单上的数字一个字都不会变。

### 技术栈与规模

| 层 | 选型 | 版本 | 为什么 |
|---|---|---|---|
| 前端框架 | Next.js（App Router）| 16.4.5 | 前后端同仓库、同语言，一个进程部署，内部工具不需要拆服务 |
| UI 运行时 | React | 19.3.1 | 与 Next 16 配套 |
| 语言 | TypeScript | 5.9.3 | 金额、单位、口径这类逻辑必须靠类型兜住 |
| 样式 | Tailwind CSS | 4.3.4 | 配合 `design-system/` 的 265 个 token，组件里禁止裸 hex |
| 数据请求 | TanStack Query / Table | 5.105.3 / 8.21.3 | 列表页排序、筛选、缓存 |
| 数据库 | PostgreSQL | 18（生产 `postgres:18-alpine`）| 需要 `EXCLUDE` 约束、生成列、`gin_trgm` 模糊搜索，这些 MySQL 给不了 |
| 数据访问 | Prisma + `@prisma/adapter-pg` | 7.10.1 | 迁移有校验、类型由 schema 生成 |
| 校验 | zod | 4.6.7 | 请求体与查询参数统一校验 |
| 认证 | jose（JWT + HttpOnly Cookie）| 6.2.15 | access 15 分钟、refresh 7 天 |
| 导出 | exceljs | 4.4.0 | 客户版 Excel 需要列宽、换行、打印区域 |
| 图表 | recharts | 3.10.1 | 价格趋势、毛利分布 |
| 图标 | lucide-react | 1.67.0 | 全项目统一一套 SVG 描边图标，**不用 emoji 当图标** |

规模（当前版本 0.1.21）：**18 张表 / 6 个迁移 / 61 个接口路由 / 12 个页面 / 106 条单测 / 86 项部署自检**。

### 明确不做的事

写在这儿是为了防止范围蔓延：

- 项目成本核算、ERP、财务系统对接；
- 对外报价门户（客户自己登录看价）；
- 多租户 SaaS（只有 admin / member 两级）；
- 服务端 PDF 渲染（客户版走浏览器打印）；
- 档期日历（人员比价页原设计的 30 天档期格没有数据源，界面上是一段说明而不是空方块）；
- 自动备份（备份命令要自己配 cron）。

---

## 二、文件结构

### 顶层目录

```
youdee/
├── src/                      # 应用源码（页面 + 接口 + 领域逻辑 + 服务层）
├── prisma/
│   ├── schema.prisma         # 17 张表、关系、索引
│   ├── migrations/           # 5 个手写迁移（EXCLUDE / 生成列 / 触发器只能用 SQL 写）
│   └── seed.ts               # 种子数据（幂等：已有用户就跳过）
├── design-system/            # 设计 token（265 个，CSS + JSON 两份）
├── public/                   # 构建期静态资源（logo、favicon）
├── scripts/db.mjs            # 本地数据库启停（仅开发机用，部署时不需要）
├── tests/                    # 领域层单元测试（8 个文件 / 104 条）
├── deploy/                   # 部署脚本 + 部署后自检
├── Dockerfile                # 生产镜像
├── docker-compose.yml        # app + postgres 18
├── package.json              # 依赖版本逐个锁死（不用 ^ / latest）
├── next.config.ts
├── prisma.config.ts
└── README.md                 # 本文件
```

### 逐目录说明

**`src/app/` —— 页面与接口（Next.js App Router）**

```
src/app/
├── (app)/                    # 登录后的业务页，共用侧边栏布局（layout.tsx）
│   ├── page.tsx              # 总览
│   ├── quotes/               # 报价单列表 / [id]/edit 编辑 / [id]/preview 客户版
│   ├── materials/            # 物料库 / [id] 比价与档案
│   ├── staff/                # 人员库 / [id]
│   ├── vendors/              # 供应商库
│   ├── guests/               # 客户 / 项目台账
│   └── settings/             # 公司抬头、报价默认值、账号
├── login/                    # 登录页（唯一不需要登录的页面）
├── api/v1/                   # 59 个 route.ts，REST 接口
└── uploads/                  # 附件读取（实际文件落在 UPLOAD_DIR）
```

接口按资源分组，命名即行为：

| 分组 | 代表端点 | 说明 |
|---|---|---|
| 认证 | `/auth/login` `/auth/me` `/auth/password` | 登录、会话、改口令 |
| 主数据 | `/items` `/suppliers` `/units` `/categories` | 物料与人员共用 `items`，靠 `kind` 分 |
| 价格 | `/prices` `/prices/:id/history` `/price-lookup` | 录价、改价、历史、取价 |
| 比价 | `/items/:id/compare` | 按口径分组、算归一价、标不可比 |
| 报价单 | `/quotes` `/quotes/:id/items` `/quotes/:id/issue` | 建单、加行、出单 |
| 导出 | `/quotes/:id/export.xlsx` | 客户版 / 内部版 Excel |
| 设置 | `/settings/company` `/settings/quote` `/users` | 抬头、默认值、账号 |
| 运维 | `/health` | 进程与数据库分别报状态 |

**`src/domain/` —— 纯函数，不碰数据库、不碰 HTTP（10 个文件）**

| 文件 | 职责 |
|---|---|
| `money.ts` | 金额四舍五入、分/元转换、格式化 |
| `units.ts` | 单位折算（1㎡ = 几张），未填就返回不可比 |
| `price-resolve.ts` | 取价：按主体 + 供应商 + 口径 + 日期命中唯一一条 |
| `compare.ts` | 比价：分组、归一价、排序、不可比原因 |
| `quote-calc.ts` | 报价行计算：数量 × 单价、毛利率反算、合计与优惠 |
| `quote-status.ts` | 状态机 draft → issued → void |
| `permissions.ts` | 谁能改旧价、谁能删主数据 |
| `customer-sheet.ts` | **客户版版面的唯一来源**：列定义、行内容、合计。HTML 打印与 Excel 都读它 |
| `invoice-info.ts` | 开票信息校验与格式化 |
| `phone.ts` | 电话归一（全角转半角、只数数字、≥7 位） |

**`src/server/` —— 服务端基础设施与业务服务**

```
src/server/
├── db.ts                     # pg 连接池（单例）
├── http.ts                   # 错误翻译（数据库错误 → 人话）、请求解析
├── params.ts                 # 查询参数解析与校验
├── wrap.ts                   # 路由包装：统一 try/catch 与响应格式
├── quote-item-body.ts        # 报价行请求体转换
├── auth/                     # JWT 签发校验、口令哈希、会话 Cookie
├── services/                 # 业务服务层（33 个文件）：quote / price / item / compare / export …
└── store/                    # 数据访问（SQL）：prices / quotes / settings
```

分层是单向的：`app/api → services → store → db`，`domain` 谁都可用但自己不依赖任何东西。

**`src/components/` —— 组件（55 个文件）**

```
src/components/
├── quote/        # 明细表、单头、行备注、客户版纸面（paper-sheet.tsx）
├── compare/      # 比价表格、不可比提示、价格趋势
├── staff/        # 人员库表格与抽屉
├── vendors/      # 供应商表格、开票信息表单
├── settings/     # 设置页各分区
└── ui/           # Button / Input / Select / Field / Drawer / Table 等基础件
```

**其他**

| 路径 | 说明 |
|---|---|
| `design-system/design-tokens.css` | 颜色、间距、字号、圆角全部来自这里；组件里写裸 hex 视为缺陷 |
| `prisma/migrations/*` | 每个迁移一个目录，`migration.sql` 手写。`EXCLUDE`、生成列、触发器 Prisma 生成不出来 |
| `prisma/seed.ts` | 17 单位 / 8 供应商 / 35 分类 / 25 主体 / 48 条价格；**幂等**，已有用户就整段跳过 |
| `tests/` | 只测 `domain/` 纯函数，不连库、不起服务，所以秒级跑完 |
| `deploy/verify.mjs` | 部署后自检，86 项，逐项比对具体数值 |

### 几个「改了会影响哪里」的定位表

| 你想改 | 只改这里 | 会同时影响 |
|---|---|---|
| 客户版列的顺序 / 表头文案 / 列宽 | `src/domain/customer-sheet.ts` 的 `sheetColumns()` | 打印页、PDF、客户版 Excel（三处同源） |
| 客户版某个格子显示什么 | 同上 `sheetCellText()` + `export.service.ts` 的 switch | 同上 |
| 纸面样式（字号、内边距、折行） | `src/app/globals.css` 的 `.paper-*` | 打印与屏幕预览 |
| 金额怎么算（四舍五入、毛利反算） | `src/domain/money.ts` / `quote-calc.ts` | 报价单、比价、导出 |
| 接口报错的提示文案 | `src/server/http.ts` | 全部接口 |
| 主题色、间距 | `design-system/design-tokens.css` | 全站 |
| 默认税口径、默认毛利率、预警线、有效期天数 | 数据库 `app_settings`（界面上是「设置 → 比价与计价规则」） | 建单、比价、预警 |
| 客户版抬头印的供应商名称 | 设置 → 报价单模板（建单时选模板，值快照进单据） | 只影响之后新建的单，历史单不变 |

---

## 三、部署方式

### 先选路径

| 你的场景 | 走哪条 | 需要准备 |
|---|---|---|
| 只在自己电脑上看看 / 二次开发 | [路径 A](#路径-a本地跑起来5-分钟) | Node.js 20.19+（推荐 22） |
| 上线到一台 Linux 服务器（推荐） | [路径 B](#路径-bdocker-compose生产推荐手把手) | 2 核 2G 的 Linux + 能装 Docker |
| 服务器不能装 Docker | [路径 C](#路径-c裸机-node--postgresql不能装-docker-时) | Linux + Node 20.19+ + PostgreSQL 14+ |

服务器最低要求：**2 核 / 2 GB 内存 / 10 GB 盘**。1 GB 的机器很容易在 `next build` 阶段被 OOM killer 杀掉，表现为「构建到一半进程消失」。系统要求任意 x86_64 Linux，脚本已在 Debian/Ubuntu 与 RHEL 系上验证。

---

### 路径 A：本地跑起来（5 分钟）

**这一步不需要 Docker**——本地数据库用的是 `embedded-postgres`，会在项目里起一个真 PostgreSQL 18 二进制。

#### 第 1 步：确认 Node 版本

```bash
node -v
```

要 `v20.19.0` 以上，推荐 `v22.x`。低于 20.19 直接装新的：

```bash
# Debian / Ubuntu / WSL
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# macOS
brew install node@22

# Windows：到 nodejs.org 下 LTS 安装包，或 winget install OpenJS.NodeJS.LTS
```

#### 第 2 步：装依赖

```bash
cd youdee
npm install
```

500 多个包，国内网络可能几分钟。**不要**把 `package.json` 里的版本号改成 `^` 或 `latest`——版本是逐个锁死的，改了会出现「同一份代码两台机器两种行为」。

#### 第 3 步：配置环境变量

```bash
cp .env.example .env
```

`.env.example` 里的默认值直接可用（连的是本地 55432）。只有一项建议现在就改：

```bash
# 生成一个随机密钥，粘到 .env 的 JWT_SECRET=
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

#### 第 4 步：起数据库（占一个终端）

```bash
npm run db:start
```

首次会自动下载 PostgreSQL 二进制（几百 MB），**这个终端要保持开着**——它是前台阻塞的。看到 `database is ready` 类字样即成功。另开一个终端继续。

#### 第 5 步：建表 + 灌种子

```bash
npm run db:migrate     # 建 17 张表
npm run db:seed        # 灌 17 单位 / 8 供应商 / 35 分类 / 25 主体 / 48 条价格
```

种子最后会打印各表条数，以及两个账号：

```
[seed] 管理员 admin / youdee2026    成员 xiaowang / youdee2026
```

#### 第 6 步：起开发服务器

```bash
npm run dev
```

打开 <http://localhost:3000>，用 `admin` / `youdee2026` 登录。

#### 第 7 步（可选但推荐）：跑一遍自检

```bash
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=youdee2026 MEMBER_PASSWORD=youdee2026 node deploy/verify.mjs
```

86 项全过说明整条链路是通的（登录 → 比价 → 取价 → 建单 → 出单 → 导出 → 权限 → 约束）。它会自己清理产生的临时数据。

---

### 路径 B：Docker Compose（生产推荐，手把手）

#### 第 1 步：准备服务器

```bash
ssh root@你的服务器IP
cat /etc/os-release        # 确认发行版
free -h                    # 确认内存 >= 2G
df -h /                    # 确认盘 >= 10G
```

防火墙 / 安全组放行你要用的端口（默认 3000）。如果打算挂域名走 Nginx，就只对内网开放 3000。

#### 第 2 步：在本地打包

在**你的开发机**上、项目根目录执行：

```bash
bash deploy/pack.sh
```

产物在 `dist/`：

```
dist/youdee-0.1.21-20261106.tar.gz
dist/youdee-0.1.21-20261106.tar.gz.sha256
```

包里是源码 + 部署脚本，**不含** `node_modules` / `.next` / `.env` / 上传的附件。
`pack.sh` 出包前会跑三道门禁（lockfile 与 `package.json` 是否同步、`prisma validate`、包内换行符是否全为 LF），任何一道不过就拒绝出包——省得你等完一轮镜像构建才发现。

#### 第 3 步：上传

```bash
scp dist/youdee-0.1.21-20261106.tar.gz root@你的服务器IP:/tmp/
```

服务器访问慢的话，先在本机传到中转（对象存储 / 内网跳板），再在服务器上 `wget`。

#### 第 4 步：解包

在**服务器**上：

```bash
mkdir -p /opt/youdee
tar -xzf /tmp/youdee-0.1.21-20261106.tar.gz -C /opt/youdee
cd /opt/youdee
chmod +x deploy/*.sh
ls deploy/            # 确认脚本在
```

#### 第 5 步：写 `.env`（三个值必须改）

```bash
cd /opt/youdee
cp deploy/env.example .env
openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64     # 生成 JWT_SECRET
openssl rand -hex 16                                      # 生成 PG_PASSWORD
vi .env
```

要改的只有三行：

```ini
PG_PASSWORD=上一步生成的十六进制串
JWT_SECRET=上一步生成的 64 位串
APP_PORT=3000                  # 对外端口；容器内始终 3000
```

加锁：

```bash
chmod 600 .env
```

三条硬性注意：

- **`JWT_SECRET` 用模板占位值上线 = 任何人都能伪造登录态。**
- **`PG_PASSWORD` 只用字母数字。** 它会被拼进 `DATABASE_URL`，含 `@ : / ? #` 会让连接串解析错位，报错是 `getaddrinfo ENOTFOUND`，看着像网络问题其实不是。
- 国内机器拉包常超时，`.env` 里加一行 `NPM_REGISTRY=https://registry.npmmirror.com`（留空就是官方源）。

#### 第 6 步：装 Docker（没装过才需要）

```bash
sh deploy/bootstrap.sh
```

装完**退出 SSH 重新登录**，否则 `docker` 命令仍报 permission denied（组权限要重开会话才生效）。验证：

```bash
docker --version
docker compose version
```

#### 第 7 步：构建并启动

```bash
cd /opt/youdee
sh deploy/remote-up.sh
```

它会依次做：检查 `.env` → `docker compose build` → 起 db（等健康检查通过）→ 起 app → 轮询 `/api/v1/health` 直到 `db=ok`。

首次构建 **3–6 分钟**（`npm ci` + `next build`）。看到类似输出即成功：

```
服务已就绪：http://服务器IP:3000
```

容器启动时会自动做三件事（`deploy/entrypoint.sh`）：

1. 等数据库可连（`wait-db.mjs`）；
2. `prisma migrate deploy` 应用迁移；
3. 跑种子（`SEED_ON_BOOT=1`，脚本自己判「已有用户就跳过」，所以每次启动都跑是安全的）。

设置 `SEED_ON_BOOT=0` 可关掉种子——但空库上首次部署会得到一个能登录、什么都没有的系统。

#### 第 8 步：部署后自检（**不能跳过**）

```bash
docker compose exec app node deploy/verify.mjs
```

期望结尾：

```
合计 86 项，通过 86，失败 0
```

只看到「网页能打开」不算部署成功——这个系统最危险的缺陷全都不报错，只是数字不对（比价算出最低价、导出少一列、成员能改旧价）。

#### 第 9 步：登录并改口令

浏览器打开 `http://服务器IP:3000`，用 `admin` / `youdee2026` 登录，立刻到「设置 → 账号」改掉 `admin` 与 `xiaowang` 的口令。

#### 第 10 步：确认数据落在卷里

```bash
docker volume ls | grep youdee      # 应看到 youdee_dbdata 与 youdee_uploads
docker compose ps                   # app / db 都是 running (healthy)
```

`docker compose down -v` 会**删卷等于删库删附件**，不要随手敲。

---

### 路径 C：裸机 Node + PostgreSQL（不能装 Docker 时）

#### 第 1 步：装 Node 22

```bash
# RHEL / CentOS / openEuler
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs

# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

node -v      # 要 v22.x
```

Node 20.19+ 也能跑主链路，但 `vitest` 声明要 22，`npm ci` 会刷一串 `EBADENGINE`。**那是警告不是失败**，安装会继续，代价只是生产机上跑不了 `npm test`。

#### 第 2 步：装 PostgreSQL 并建库

```bash
# Debian / Ubuntu
sudo apt-get install -y postgresql postgresql-contrib

# RHEL 系
sudo yum install -y postgresql-server postgresql-contrib && sudo postgresql-setup --initdb
```

建库建用户（口令用纯字母数字）：

```bash
sudo -u postgres psql <<'SQL'
CREATE USER youdee WITH PASSWORD '改成随机字母数字串';
CREATE DATABASE youdee OWNER youdee ENCODING 'UTF8';
SQL
```

检验能连上：

```bash
psql "postgresql://youdee:你的口令@127.0.0.1:5432/youdee" -c '\conninfo'
```

连不上先查 `pg_hba.conf`（默认可能只允许 local socket），把 `host all all 127.0.0.1/32 scram-sha-256` 打开后 `systemctl reload postgresql`。

#### 第 3 步：解包并配置

```bash
sudo mkdir -p /opt/youdee && sudo chown $USER /opt/youdee
tar -xzf youdee-0.1.21-20261106.tar.gz -C /opt/youdee
cd /opt/youdee
cp deploy/env.example .env
vi .env
```

裸机路径关键的是这一行（host 是 `127.0.0.1`，不是容器里的 `db`）：

```ini
DATABASE_URL=postgresql://youdee:你的口令@127.0.0.1:5432/youdee?schema=public
JWT_SECRET=改成随机长串
NODE_ENV=production
PORT=3000
```

```bash
chmod 600 .env
```

> `NODE_ENV=production` 会让 npm 走 `omit=dev` 跳过 devDependencies，而构建恰恰要用 `@tailwindcss/postcss` / `typescript`。`manual-deploy.sh` 已经在安装那一步显式还原成 `development` 并加 `--include=dev`，**不要为了装包手动把这行改成 development**——改了运行期就变成 dev 模式（错误信息外泄、性能差）。

#### 第 4 步：构建并迁移

```bash
cd /opt/youdee
sh deploy/manual-deploy.sh
```

它会：装依赖（`--include=dev`）→ 按文件校验 PostCSS 插件是否真的能解析 → 清 `.next` → 生成 Prisma 客户端 → `next build`（Turbopack 失败自动换 webpack）→ 应用迁移 → 灌种子。`DATABASE_URL` 没填好会停下并提示，不会带着错配置继续。

#### 第 5 步：交给 systemd

```bash
sudo useradd -r -s /sbin/nologin youdee
sudo chown -R youdee:youdee /opt/youdee
sudo cp deploy/youdee.service /etc/systemd/system/youdee.service
sudo systemctl daemon-reload
sudo systemctl enable --now youdee
sudo systemctl status youdee        # 看是否 active (running)
journalctl -u youdee -f             # 跟日志
```

不想用 systemd，前台试跑看日志：

```bash
cd /opt/youdee && npx next start -H 0.0.0.0 -p 3000
```

#### 第 6 步：自检

```bash
cd /opt/youdee
node deploy/verify.mjs                                    # 打本机 3000
BASE_URL=http://你的IP:3000 node deploy/verify.mjs        # 打对外地址
```

设了自定义口令的话带上环境变量：

```bash
ADMIN_PASSWORD=你的管理员口令 MEMBER_PASSWORD=你的成员口令 node deploy/verify.mjs
```

---

### 部署后必做：跑自检

```bash
# Docker
docker compose exec app node deploy/verify.mjs

# 裸机
cd /opt/youdee && node deploy/verify.mjs
```

它走完整条链路并在每项上比对**具体数值**，不是「有响应就算过」：

```
[通过] 健康检查 — db=ok
[通过] 管理员登录 — 管理员
[通过] 会话 Cookie 能落到浏览器 — http 目标且未带 Secure，浏览器可写入
[通过] 物料库已初始化 — material 共 15 条
[通过] 比价命中 1 组 — custom_made / 非时间 / 可比 2/3
[通过] 不可比的行没有被隐藏 — 共 3 行 = 可比 2 + 不可比 1
[通过] 标出了最低价 — 本公司自有 归一价 80.5562
[通过] 比价价 = 取价价（同一价同一个数）
[通过] 成员改旧价被拒 — 返回 40302
[通过] 区间重叠被拦 — 人话提示，不含数据库术语
...
合计 86 项，通过 86，失败 0
```

自检会自己收尾：临时账号固定为 `selfcheck_temp`（首次建、之后复用），自检单跑完自动删除，不会往你的列表里堆垃圾数据。

有失败项时，脚本会打印实际值与期望值，照着本文第三节末尾的「常见故障对照」表处理。

---

### 放到域名 / HTTPS 后面

项目本身只提供 HTTP。要上域名就在前面加 Nginx 或 Caddy 做 TLS：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;   # 必须，否则 Cookie 不带 Secure
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 6m;                      # 附件上限 5MB
}
```

如果代理不传 `X-Forwarded-Proto`，就在 `.env` 里显式写 `COOKIE_SECURE=1`。

> **一个很坑的现象**：登录接口返回 200、账号密码都对，但紧接着就提示「登录已过期，请重新登录」。原因是 `Set-Cookie` 带了 `Secure`，而浏览器访问的是 `http://IP:3000`——带 `Secure` 的 Cookie 在 http 页面上会被浏览器**静默丢弃**。本版已改成按请求实际协议判断，只有代理终结 TLS 时才需要 `COOKIE_SECURE=1`。

---

### 日常运维：更新、备份、恢复、回滚

**更新到新代码**（Docker）：

```bash
cd /opt/youdee
# 上传并解包新版本，覆盖源码，但保留 .env
tar -xzf /tmp/youdee-<新版本>.tar.gz -C /opt/youdee
sh deploy/remote-up.sh
```

**常用状态命令**：

```bash
docker compose ps                  # 状态
docker compose logs -f app         # 应用日志
docker compose restart app         # 重启（不重建）
docker compose down                # 停掉（数据在卷里，不丢）
docker compose exec db psql -U youdee -d youdee     # 进库
```

**备份**（建议配 cron，每天一次）：

```bash
# Docker：数据库 + 附件
docker compose exec -T db pg_dump -U youdee youdee | gzip > backup-$(date +%F).sql.gz
docker run --rm -v youdee_uploads:/u -v "$PWD":/b alpine tar czf /b/uploads-$(date +%F).tar.gz -C /u .

# 裸机
pg_dump -U youdee youdee | gzip > backup-$(date +%F).sql.gz
tar czf uploads-$(date +%F).tar.gz -C /opt/youdee var/uploads
```

**恢复**：

```bash
gunzip -c backup-2026-11-05.sql.gz | docker compose exec -T db psql -U youdee -d youdee
# 裸机：gunzip -c backup.sql.gz | psql -U youdee -d youdee
```

**回滚**：代码层重新上传上一版压缩包再构建即可。数据库层要注意——**迁移是前进式的，没有 down 脚本**，回滚代码前先 `pg_dump`；如果新版迁移改过表结构，旧代码可能读不了新结构，这时用部署前的备份恢复。

---

### 常见故障对照

| 现象 | 原因 | 处理 |
|---|---|---|
| 容器起来又退出，日志停在「等待数据库就绪」 | 库没起来或密码错 | `docker compose logs db`；核对 `.env` 的 `PG_PASSWORD` 与卷里旧密码是否一致（改过口令但没删卷会认证失败） |
| `getaddrinfo ENOTFOUND` | `PG_PASSWORD` 含 `@ : / ? #`，连接串解析错位 | 换成纯字母数字口令，`docker compose down -v` 后重建 |
| `npm ci` 报 `lock file's X does not satisfy Y` | `package-lock.json` 与 `package.json` 不同步 | `npm ci --dry-run` 定位 → 删掉确实没人用的依赖 → 重新生成锁文件。**不要把 `npm ci` 改成 `npm install` 糊过去** |
| `npm ci` 报 `EACCES` / 缓存路径不存在 | 仓库里的 `.npmrc` 写死了 Windows 缓存路径 | 该文件已被 `.dockerignore` 排除；裸机路径下删掉 `.npmrc` 里的 `cache=` |
| 构建卡在 `npm ci`，大量 `ETIMEDOUT` | 官方 registry 在国内慢 | `.env` 加 `NPM_REGISTRY=https://registry.npmmirror.com` 后重 build |
| 构建被 Killed | 内存不足 | 加 swap 或换 2G 机器；`NODE_OPTIONS=--max-old-space-size=1536` |
| 构建报 `Cannot find module '@tailwindcss/postcss'` | devDependencies 没装（`NODE_ENV=production` 导致 `omit=dev`），或 `.next` 里有失败残留 | 裸机：`rm -rf node_modules .next && NODE_ENV=development npm ci --include=dev`；Docker：确认构建参数没设 `NODE_ENV=production` |
| 页面能开，登录报 500 | 迁移没跑或库连不上 | `docker compose logs app` 看首个报错；确认 `prisma migrate deploy` 有输出 |
| 登录后立刻提示「登录已过期」 | Cookie 带 `Secure` 但访问的是 http | 让代理传 `X-Forwarded-Proto`，或显式 `COOKIE_SECURE=1` |
| 上传图片后刷新 404 | `var/uploads` 没挂卷，或目录属主不对 | 确认 compose 有 `uploads` 卷；容器内属主应为 `app`(10001) |
| 端口被占 | 3000 有别的服务 | `.env` 改 `APP_PORT=8080` 后 `docker compose up -d` |
| 中文乱码 | 库编码不是 UTF8 | 建库时 `ENCODING 'UTF8'`；本项目迁移含中文默认值与注释 |
| `prisma migrate deploy` 报 P3025 | 配置里设了 `shadowDatabaseUrl` 且与主库相同 | `prisma.config.ts` 已移除该字段，不要加回去 |
| 纯离线服务器 `docker build` 失败 | 没有外网装依赖 | 在能联网的**同架构 Linux** 上 `docker compose build` → `docker save` → 拷过去 `docker load` → `docker compose up -d`（跳过 `--build`） |

更长的排障过程（含 PostCSS 解析失败的三步判定、锁文件不同步的定位方法）见本文第三节的「常见故障对照」。

---

## 四、常用命令

```bash
# 开发
npm run dev            # 开发服务器
npm run build          # 生产构建
npm run start          # 生产启动（需先 build）
npm run typecheck      # 类型检查
npm test               # 领域层单测（106 条）

# 数据库（本地开发）
npm run db:start       # 起本地 embedded-postgres（前台阻塞）
npm run db:stop        # 停
npm run db:status      # 连通性
npm run db:migrate     # 应用迁移
npm run db:seed        # 灌种子（幂等）
npm run db:reset       # 清库重建（会丢数据）

# 部署
bash deploy/pack.sh            # 出交付包到 dist/
bash deploy/deploy.sh root@IP  # 本机 → 远端一键（需 ssh 可达）
sh deploy/remote-up.sh         # 远端：构建并启动（Docker）
sh deploy/manual-deploy.sh     # 远端：构建并启动（裸机）
node deploy/verify.mjs         # 部署后自检（86 项）
```

---

## 五、还缺客户提供的东西

**单位折算表**。下面这些物料的真实折算关系只有客户知道，系统不能凭空填：

| 物料 | 比价基准 | 供应商常按 | 需要确认 |
|---|---|---|---|
| 喷绘布 | ㎡ | 张 | 1㎡ = 几张 |
| KT 板 | ㎡ | 张 | 1 张 = 几㎡（常规 1.2×2.4m） |
| 桁架 | m | 根 | 1 根 = 几米 |
| LED 屏 | ㎡ 或 天 | 块 / 套 | 1 块 = 几㎡ |
| 地毯 | ㎡ | 卷 | 1 卷 = 几㎡ |
| 易拉宝 | 个 | 套 | 是否含画面 |

不填不会崩：这些物料照样能录价、能出单、能看到各家原价，只是**不标「最低」**，比价页会写明「未填折算系数，不可比」。填了才会出现「某某家便宜 6.25%」这类结论。

---

## 六、许可与使用范围

内部工具，按「自用」授权。没有多租户隔离、没有对外注册，不适合直接改成 SaaS 对外服务。
