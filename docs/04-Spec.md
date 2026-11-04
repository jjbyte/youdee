# Spec —「有底」v1.0（规格即契约）

> 生成日期：2026-11-04
> 基于：`01-PRD.md` v1.9.2（1557 行）+ `02-ARCHITECTURE.md`（2774 行）+ `03-UIUX.md` v1.7.2（3060 行）+ `01a` 验收用例（232 条）
> 状态：**已锁定**（客户 2026-11-04 确认三文档）
> 效力：本文档是**开发期的唯一裁判**。与 PRD / 架构 / UIUX 冲突时以本文档为准，并回写修正那三份。

---

## 1. 产品定义

| 项 | 内容 |
|---|---|
| 一句话 | 把公司花出去的钱攒成一本账，下次报价时一查就知道该报多少 |
| 产品名 | **有底**（报价单模块内部叫「攒单」） |
| 目标用户 | 报价员（主）、项目经理、采购、老板；公司内部 3-10 人 |
| 核心问题 | 同一物料在不同供应商价差极大（淘宝 vs 线下定做厂），同一类人员各家单价不同，价格散落在微信/Excel/记忆里 |
| 与 Excel 的根本差异 | Excel 能排序，不能判断"两个数能不能比"。比价需要业务规则（单位折算、交易性质分组、税口径分组），规则必须写进系统 |

---

## 2. MVP 范围（锁定 — 不在此列表的功能一律不做）

14 项 P0，闭环是「录价 → 比价 → 出单」：

| # | 功能 | 验收标准摘要 |
|---|---|---|
| 1 | 账号登录 + 两级角色 + 成本价隔离 | admin / member；member 可看成本算毛利，**不可导出含成本文件** |
| 2 | 供应商档案（5 类型） | `online` / `factory` / `rental` / `freelancer` / `internal` |
| 3 | 分类体系（双域两棵树） | material 8 类 / personnel 8 类，可增删改名 |
| 4 | 物料价格库 | 含单位、规格、多供应商、图片、淘宝链接 |
| 5 | 人员价格库 | 含计价方式（按天/按场/按人天/按小时/按半天）、是否含差旅 |
| 6 | 价格有效期 | 生效日/失效日；四级状态派生（有效/软陈旧/硬失效/被替代） |
| 7 | 数量阶梯价 | 同一条价下多档 `min_qty → unit_price` |
| 8 | 多供应商并排比价 | 按「交易性质 → 税口径 → 可比性」三层分组，同组内标最低 |
| 9 | 数量档切换 | 前端本地命中，不重新请求 |
| 10 | 历史价格趋势 | 按版本序列，台阶线 |
| 11 | 图片与链接附件 | 参考图 + 淘宝外链；客户版只带物料图、不带报价截图 |
| 12 | 搜索 | 名称模糊（`pg_trgm`）+ 分类筛选 |
| 13 | 勾选生成报价单 | 快照 + 成本/毛利 + 参考最低价对照 + 手填成本兜底 |
| 14 | 发送前自检 + 出单通知 | 7 项 warning + 1 项 blocker（客户名空）+ 站内通知 |

**另含两项客户明确要求的配置能力（非独立功能，随上述实现）：**
- 项目类型 → 毛利预警阈值（5 值 + 全局默认）
- 单位折算系数（单条价格上的选填 `base_unit_qty`）

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做 | 原因 | 何时考虑 |
|---|---|---|
| 项目成本核算 / 预算 / 合同 / 开票 | 客户明确不要，MVP 是价格库不是 ERP | 有明确诉求后单独立项 |
| 审批流 | **客户原话：「不要审批，不要发出蠢单就行」**。用发送前自检替代 | 不做。客户要的是拦截，不是等人签字 |
| 库存管理 | 活动物料无结存概念 | 永不 |
| 人员排期 / 档期 | 本次未提 | v2 |
| 客户 CRM | 客户只是 `quotes.customer_name` 字符串 | v2 |
| 报价单在线签署 / 客户自助查看 | 价格是公司最敏感数据，不做公开路由 | 永不（见 §10） |
| 税额拆分（专票/普票） | MVP 不采集税率，**算错的开关比没有开关更糟** | P1 加 `tax_rate` 后 |
| 多币种 | 恒 CNY | 有海外业务时 |
| 独立移动端 App | **客户明确：手机查价不是刚需**，只做只读 | 若变刚需，独立立项 |
| 智能比价建议 / 涨价预警 | 无算法模块 | v2 |
| 别名同义词搜索 | 字段保留（零成本），MVP 不查 | v2 |
| 人数 × 天数自动换算 | 数量单字段，用户直接填结果（3人2天填6） | v2 |
| 首页数据大屏 | 工作台只有待办 + 最近改价 + 常用入口 | 永不（内部工具不做大屏） |
| 供应商评分 | — | v2 |

---

## 4. 技术架构（锁定 — 含环境实测）

### 4.1 技术栈（版本已联网核实并实测可用 2026-11-04）

| 层 | 技术 | 锁定版本 | 说明 |
|---|---|---|---|
| 运行时 | Node.js | **22.22.2（实测本机）** | 见 §4.2 偏差 1 |
| 包管理 | npm | **10.9.7（实测本机）** | 见 §4.2 偏差 2 |
| 全栈框架 | Next.js | **16.4.5** | 精确锁，不带 `^` |
| UI 运行时 | React / React DOM | **19.3.1** | 两者必须同版本 |
| 类型系统 | TypeScript | **5.9.3** | 见 §4.2 偏差 3 |
| 样式 | Tailwind CSS | **4.3.4** | CSS-first，`@theme` |
| 组件基座 | shadcn/ui CLI（Radix 底座） | 4.19.x | `init -b radix` |
| 图标 | **lucide-react** | **1.67.0** | 全项目唯一，见 §4.2 偏差 4 |
| 服务端状态 | @tanstack/react-query | 5.x | 无 v6 |
| 表格 | @tanstack/react-table | 8.21.3 | 否决 AG Grid |
| 图表 | recharts | 3.10.1 | `type="stepAfter"` |
| 表单 | 不用第三方库，受控 state | — | **已移除 react-hook-form / @hookform/resolvers**，见 §4.3 偏差 |
| ORM | Prisma | **7.10.1（显式锁，禁用 latest）** | 见 §4.2 偏差 5（关键） |
| DB 驱动 | @prisma/adapter-pg + pg | 8.x | — |
| 数据库 | PostgreSQL | **18.6** | 本地用 embedded-postgres，生产 Docker |
| JWT | jose | 6.2.x | HS256 + httpOnly Cookie |
| 密码 | node:crypto scrypt | 内置 | 不用 bcrypt（原生模块编译坑） |
| 图片 | sharp | 0.x（锁文件为准） | 缩略图 + 类型嗅探 |
| Excel 导出 | exceljs | 4.4.0 | 隔离单文件 |
| PDF | 浏览器原生打印 | — | 不引 Playwright |

### 4.2 环境实测偏差（必须遵守，否则装不上或跑不起来）

| # | 架构原定 | 实际环境 | 处置 | 影响 |
|---|---|---|---|---|
| 1 | Node.js 24.x LTS | **22.22.2** | 采用 22.22.2 | 无。Next 16 要求 `>=20.9`，Prisma 7 要求 `^20.19 \|\| ^22.12 \|\| >=24`，22.22.2 同时满足 |
| 2 | pnpm 10 | **无 pnpm** | 改用 npm 10.9.7 | 仅锁文件格式（`package-lock.json`） |
| 3 | TypeScript 5.9.x | npm `latest` 是 **7.0.2** | **必须显式装 `typescript@5.9.3`** | 裸装会拿到 TS 7（Go 重写版），Next 16 生态未验证 |
| 4 | lucide-react 1.64.0 | 实际最新 **1.67.0** | 采用 1.67.0 | v1 major 内，图标名未变 |
| 5 | prisma 7.10.x | `prisma@latest` = **8.0.0-rc.30**，`@prisma/client@latest` = 7.10.1 | **`prisma@7.10.1` + `@prisma/client@7.10.1` 双显式锁** | 裸装得到"8 RC 的 CLI + 7 的 client"，`prisma generate` 直接崩 |
| 6 | Docker Compose 起 PG | **无 Docker** | 本地开发用 `embedded-postgres@18.6.0-beta.19`（真 PG 18.6 二进制） | 生产部署仍用 Dockerfile，本地不需 Docker |
| 7 | `npm` 默认缓存 | `D:\Program Files\nodejs\node_cache` **无写权限（EPERM）** | 项目根 `.npmrc` 写 `cache=C:/Users/ssg/.workbuddy/npm-cache` | 不改则所有 npm 操作失败 |
| 8 | 连接串写在 `schema.prisma` 的 `datasource.url` | **Prisma 7 已移除该字段**，CLI 报 P1012 | 连接串搬到 `prisma.config.ts` 的 `datasource.url`；且 Prisma 7 CLI **不再自动读 .env**，必须在 config 里 `process.loadEnvFile('.env')`，否则报 "Cannot resolve environment variable: DATABASE_URL" | 迁移命令是本项目唯一的 Prisma 用途，这两步不做则一条 DDL 都上不去 |
| 9 | 用 Prisma Client 做数据访问 | 生成列 `prices.unit_mode` 无法用 ORM 表达（写入即报 `cannot insert into generated column`）；`23P01` 除约束名外无有效信息，而我们**必须**把它翻译成人话 | **数据访问改为 `pg` + 手写 SQL**（`src/server/db.ts`），Prisma 只保留迁移职责 | `migrate deploy` 只按序执行 SQL 文件、不做 diff，两者不冲突。代价：要自己写 SQL；收益：生成列与约束错误码都在掌握内 |
| 10 | access(15min) + refresh(7d) 双令牌 | 契约 53 个 path 里**没有** `/auth/refresh`。没有刷新端点时 15 分钟一过期就是把 3–10 人的内部工具每刻钟踢一次 | 单 Cookie，有效期 = `JWT_REFRESH_TTL_DAYS`，但**每次请求回库校验** `token_version` + `is_active` | 吊销仍是即时的（"退出所有设备" = token_version+1），比双令牌少一半移动部件 |
| 11 | `users.email` / `display_name` | 内部账号没有邮箱，用登录名更贴合 | 表与 API 一律 `login` / `name`；`POST /auth/login` 额外接受 `email` 作为 `login` 的别名 | 与 openapi.yaml 的字段名有一处偏差，前端按 `login`/`name` 实现 |
| 12 | 折算系数举例含糊（"喷绘 12 张/㎡"） | 实现时踩到：桁架背景板按「套」报价、比价基准是「㎡」，**不填系数则三家的行全部"不可比"，比价页一行最低价都标不出来**，而且不报错 | `base_unit_qty` 语义钉死为**乘法**：`基准单位价 = 本价格单位价 × base_unit_qty`，其中 `base_unit_qty` = 1 个基准单位等于几个本价格单位。1 套 = 18㎡ → `1㎡ = 1/18 套 = 0.055556` | 种子数据已按此填；这也是"存在但不可比的行必须保留并标记"那条原则的来由 |

| 13 | 技术栈清单含 `react-hook-form` + `@hookform/resolvers` + `zod` | 全项目 **零 import**（表单全部是受控 state）。更麻烦的是 `@hookform/resolvers@7.0.2` 把 `effect@^4.0.0` 声明为 **peer 依赖**，而 `@prisma/config@7.10.1`（`prisma` 的传递依赖）要求 `effect` 精确 `3.20.0` —— 两者无法共存，`npm ci` 在构建机上直接 `EUSAGE: lock file's effect@3.20.0 does not satisfy effect@4.1.2` | **移除 `react-hook-form` 与 `@hookform/resolvers`**（未使用，无功能损失）。`zod` 保留未删（同样未使用，但不引发冲突，留作后续校验用） | 这一冲突**只在 `npm ci` 时暴露**：`npm install` 容错更强，本地装了能跑，推到 Linux 镜像构建才失败。另见 §4.2 偏差 14 |
| 14 | `package-lock.json` 由谁生成 | 在 Windows 上 `npm install` 生成的 lockfile 与 `package.json` 的精确锁版本曾出现不同步，本地 `node_modules` 已是最新所以 `tsc`/`vitest` 全绿，**看不出任何异常** | `deploy/pack.sh` 增加打包前 `npm ci --dry-run` 门禁：lockfile 与 `package.json` 不同步就**拒绝出包**，而不是等 5 分钟后在构建机上失败 | `npm ci` 与 `npm install` 的容错差异是本项目最隐蔽的"本地能跑、部署就炸"来源之一；且 lockfile 必须包含 Linux 平台二进制（`@img/sharp-linux-x64`、`@next/swc-linux-x64-gnu`、`@tailwindcss/oxide-linux-x64-gnu`、`lightningcss-linux-x64-gnu`），已在交付前逐项核对 |

> **偏差 5 与 7 是本次环境探测的核心产出。** 前者会让 Phase 3 第一天就卡住且报错难懂；后者会让所有依赖安装失败。

### 4.3 架构形态

```
浏览器 (React 19.3 Client Components + TanStack Query/Table + shadcn/Radix + Tailwind 4.3)
   │  HTTPS + httpOnly Cookie (JWT)
   │  REST /api/v1/*
Next.js 16.4.5 单进程
   ├─ app/api/v1/**/route.ts   只做 校验→调service→返回，≤40 行
   ├─ server/services/         一资源一文件，业务逻辑
   ├─ server/repositories/     原生 SQL（EXCLUDE/CHECK/partial index 必须手写）
   └─ src/domain/              纯函数，前后端共用：compare / price-resolve / quote-calc / quote-status / permissions
PostgreSQL 18.6（btree_gist + pg_trgm + citext）
```

**唯一例外**：客户版打印页 `/quotes/:id/print?view=customer` 是 Server Component，服务端取数时裁掉成本列，响应 HTML 里不存在任何成本数字。

---

## 5. API 契约

**以 `docs/openapi.yaml`（3223 行 / 53 path / 73 操作 / 48 schema）为唯一依据。** 本节只锁纪律。

### 5.1 端点分组

| 组 | 前缀 | 说明 |
|---|---|---|
| A 认证 | `/api/v1/auth` | login / logout / me |
| B 用户 | `/api/v1/users` | 仅 admin |
| C 供应商 | `/api/v1/suppliers` | CRUD + archive |
| D 分类 | `/api/v1/categories` | 双域树 |
| E 计价主体 | `/api/v1/items` | 物料 + 人员统一 |
| F 单位 | `/api/v1/units` | 字典只读 |
| G 价格 | `/api/v1/prices` | 新建（member 可）/ 改（admin only）/ archive |
| H 取价比价趋势 | `/api/v1/price-lookup` `/compare` `/history` | 比价一次返回全部阶梯 |
| I 报价单 | `/api/v1/quotes` | CRUD + items + issue + export + risk-check + preview + refresh |
| J 系统设置 | `/api/v1/settings` | 阈值、口径、分类字典 |
| K 通知 | `/api/v1/notifications` | 站内通知 |

### 5.2 接口行为红线（违反即 P0 缺陷）

1. **`POST /quotes/:id/issue` 不得因"无有效价"拒绝**。唯一 blocker 是客户名/活动名为空。负毛利、软陈旧、非最低价、手填成本**一律只 warning**。
2. **`POST /prices` 对 member 开放**；`PATCH /prices/:id`、`archive`、`refresh-prices`、删主体、删供应商 = **admin only**。
3. **member 走"新建一条价"时**，若 `supplier_id` / `unit_code` / `pricing_nature` / `base_unit_qty` 与旧记录不一致 → **422 / 42207**。
4. **比价接口一次返回全部阶梯数组**，切数量档在前端本地命中，不发请求。
5. **`/price-lookup` 本口径无价 → 422 / 42205**，带 `other_basis_exists` / `other_basis_price` / `other_basis_tax_included` / `other_basis_price_id`（**仅提示，绝不回填 `cost_unit_price`**）。200 响应**不含**这些字段。
6. **客户版导出走独立 `QuotationPublicDTO`**，服务端渲染阶段裁字段；禁止 `hideCost` flag 写法。
7. **`export.xlsx?view=internal` 走 `requireAdmin()`** → member 403 / 40302。
8. **禁止任何免登录 token 路由**（如 `/q/:token/view`）。
9. **`refresh-prices` 的 `dry_run` 必传、无默认值**；九条不变量含"只改成本列，`sale_unit_price` 一律不动"。
10. **业务语义列禁止 `DEFAULT`**（`NOT NULL` 允许）。允许 `DEFAULT` 的只有三类：技术主键/时间戳、显式枚举兜底经评审、计算默认且有 `CHECK` 强约束。
11. **金额零浮点**：DB `numeric` ↔ Prisma `Decimal` ↔ string。禁止 JS `number`。舍入 `ROUND_HALF_UP`（`toFixed` 是 half-even，禁用）。
12. **单位折算只有乘法**：`qty_priced = qty × base_unit_qty`，`base_unit_price = unit_price × base_unit_qty`。全项目不出现除法。

---

## 6. 数据库

**17 张表**（`02-ARCHITECTURE.md` §7.3 有完整字段）：`units` / `users` / `suppliers` / `categories` / `items` / `item_images` / `item_links` / `prices` / `price_tiers` / `price_attachments` / `price_change_logs` / `quotes` / `quote_items` / `notifications` / `app_settings` / `counters` / `margin_thresholds`

### 6.1 核心约束（不可妥协）

```sql
-- 价格区间不重叠：六维唯一（item, supplier, nature, tax, unit_mode, 生效期）
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE prices ADD CONSTRAINT prices_no_overlap
  EXCLUDE USING gist (
    item_id        WITH =,
    supplier_id    WITH =,
    pricing_nature WITH =,
    tax_included   WITH =,
    COALESCE(unit_mode,'') WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (status <> 'archived');
```

**三条前提（写成 CI 元数据断言，不是靠人记）：**
- `prices.pricing_nature` 必须 `NOT NULL`（为 NULL 则 `NULL = NULL` 为假，整段约束静默失效）
- `prices_no_overlap` 的 `conkey` 长度必须 = 6（重建约束时漏一维不报错，只少挡一类冲突）
- 物料行 `unit_mode` 必须 NULL（非时间口径）

### 6.2 `pricing_nature` 四值

`purchase`（买断）/ `rental_per_day`（租赁按天）/ `custom_made`（定制加工）/ `service`（人员恒取）

**人员加 `service` 的原因**：该列在唯一键里，人员若取 NULL 会导致约束对人员整段失效且不报错。

### 6.3 `unit_mode` 五值 + NULL

`per_day` / `per_event` / `per_person_day` / `per_hour` / `per_half_day`；非时间类 → NULL。
**不存在 `per_sqm` 这种派生**（自编会让分组按单位分裂，且 `resolvePrice(unit_mode=NULL)` 会过滤掉全部物料价，比价页全空）。

---

## 7. 页面清单（9 页 + 3 个只读降级）

| # | 页面 | 路由 | 核心组件 | 主要 API |
|---|---|---|---|---|
| 1 | 登录 | `/login` | 表单 + 最近登录 | A |
| 2 | 工作台 | `/` | 三件待办 + 最近改价 + 常用入口 | I / G |
| 3 | 物料库 | `/materials` | 列表（最低价摘要多行，**不显示裸数字**）+ 矩阵比价视图 | E / H |
| 4 | 物料详情 | `/materials/:id` | **比价卡片区（交易性质 Tab）+ 趋势图 + 附件** | H / G |
| 5 | 人员库 / 详情 | `/staff` `/staff/:id` | 按 `unit_mode` 分组比价 | E / H |
| 6 | 供应商 | `/suppliers` | 列表 + 抽屉详情 | C |
| 7 | **报价单编辑器** | `/quotes/:id/edit` | 左选品抽屉 320px + 中明细 13 列 + 底部吸底汇总 | I |
| 8 | 报价单列表 / 预览 | `/quotes` `/quotes/:id/preview` | A4 预览（客户版独立 DTO） | I |
| 9 | 设置 | `/settings` | 用户权限矩阵 / 分类字典 / 阈值 / 口径 / 模板 | J / B |

**移动端只读降级（Q4 = 不是刚需）**：≥1024 完整 / 触摸为主（`pointer: coarse`）只读 / <375 提示 + 仍渲染客户名与合计。不立项独立工程。

---

## 8. 设计 Token

**以 `design-system/design-tokens.json` + `design-tokens.css`（265 个 token）为唯一来源，前端 import，禁止硬编码。**

| 项 | 值 |
|---|---|
| 主色（骨架） | 墨黑 `#14181D` |
| 行动色 | 朱砂 `#D2431F`（每屏 ≤2 处可见） |
| 纸白 | `#FFFFFF` / 中性灰 9 档 `#F7F8FA → #14181D` |
| 语义：省钱/赚钱 | 绿 `#15803D` |
| 语义：亏钱 | 红 `#B42318` |
| 语义：数据不可信 | 琥珀 `#A16207` |
| 字号 | 页面 14px / 表格 13px |
| 行高 | 表格 36px（32 紧凑 / 44 宽松） |
| 字体 | Inter + Noto Sans SC |
| 图标 | lucide-react 1.67.0，仅 16/20/24px，`strokeWidth=1.75`，唯一出口 `src/components/icons.tsx` |
| 数字 | `tabular-nums` + 右对齐 + 固定 2 位小数 + 货币符号只在列头 |

---

## 9. 验收标准

**以 `01a-PRD-口径验收用例.md` 的 232 条 TC 为唯一依据**，按 16 组组织（阶梯命中 / 单位折算 / 交易性质 / 含税口径 / 价格状态 / 版本化 / 毛利率 / 自检 / 阻断边界 / 旧价重新录价 / 快照不变性 / 客户版导出安全 / 状态机 / 权限矩阵 / 刷新不变量 / 附件鉴权）。

**开发前要求**：把 232 条按 `describe` 分组落成 vitest 用例骨架，先 `it.skip`。**测试先于实现写**——不是流程信仰，是因为这 232 条里有 60+ 条是"两个值都合法但其中一个算出错数"的场景，事后再补测一定漏。

---

## 10. 边界与约束

- 不支持 IE；Chrome / Edge / Safari 最新两版
- 1366×768 为 P0 硬下限，单性质物料页面**无横向滚动**
- 响应式：≥1024 完整 / `pointer: coarse` 只读 / <375 仅金额
- 并发 10 人，无负载均衡、无 Redis、无队列
- 数据量：3 年 4 万条价格、900 份报价单、附件 <10GB
- 性能：比价首屏 <1.5s / 搜索建议 <300ms / 报价单保存 <800ms / 导出 <5s
- **价格是公司最敏感数据**：全部端点需登录（除 login / health）
- 备份：`pg_dump -Fc` 每日 + 保留 30 天，责任人客户方

---

## 11. 内嵌已知坑（从架构与评审中提炼，实现时必须避开）

| 坑 | 表现 | 正确做法 |
|---|---|---|
| `prisma@latest` = 8 RC | 装出裂开组合，generate 崩 | 双显式锁 `7.10.1` |
| `typescript@latest` = 7.0.2 | Next 16 生态未验证 | 显式 `5.9.3` |
| `npm` 缓存无写权限 | 所有 npm 操作 EPERM | 项目 `.npmrc` 指向可写目录 |
| `allOf: [$ref] + nullable` | TS 枚举多一个永不匹配的 `"NULL"` 死键 | `type + enum + nullable` |
| `base_unit_qty NOT NULL DEFAULT 1` | 把"我不知道"静默变成"我断言 1:1" | 可空无默认 |
| `pricing_nature` 允许 NULL | EXCLUDE 对人员整段失效且不报错 | `NOT NULL` + `service` 值 |
| 改价原地 UPDATE | 历史趋势无源，旧报价单被污染 | 新增版本 + 旧版 `effective_to` 收口 |
| 报价单实时 JOIN 价格 | 供应商调价污染历史单 | 全量快照，金额列 NOT NULL 无默认 |
| 客户版用 `hideCost` flag | 某个页脚/小计标题漏出"毛利" | 独立 DTO + 服务端裁字段 + 断言 |
| 含税口径做成装饰文字 | 用户以为含税、成本按不含税取，毛利算高，**全程绿灯** | 做成取价入参，切换给整单合计前后值 |
| 列表页显示裸最低价 | 用户看到 ¥380 记一星期（那其实是租价） | 多性质条目必须"性质 + 价格"绑定 |
| 存在但不可比的行被过滤 | 用户以为该供应商没报价 | 保留 + 标记，**绝不静默删除** |
| 预览与真跑不一致 | 用户拿错预览做决定 | `preview_matches_write` 检测 |
| `toFixed` 舍入 | half-even 与财务惯例不符 | `ROUND_HALF_UP` 手写 |

---

## 12. 端到端验证步骤（完成定义）

```bash
# 0. 环境前置（一次性）
npm config set cache ...        # 或项目 .npmrc
npm ci

# 1. 启动数据库（本地 embedded-postgres，真 PG 18.6）
npm run db:start

# 2. 迁移 + 种子
npm run db:migrate
npm run db:seed                 # 17 单位 / 8+8 分类 / 5 项目类型阈值 / 1 admin

# 3. 构建与类型检查
npm run typecheck
npm run build

# 4. 启动
npm run dev                     # 等待 Ready

# 5. 核心成功流
curl -X POST localhost:3000/api/v1/auth/login -d '{"login":"admin","password":"..."}'
#   断言：200 + Set-Cookie httpOnly
curl -X POST localhost:3000/api/v1/items -d '{...桁架...}'
curl -X POST localhost:3000/api/v1/prices -d '{supplier_id, unit_price:45, effective_from:...}'
#   断言：201
curl localhost:3000/api/v1/compare?item_id=...&qty=10&pricing_nature=custom_made
#   断言：200 + 按 nature 分组 + is_lowest 唯一 + tiers 全量返回
curl -X POST localhost:3000/api/v1/quotes -d '{customer_name:"星海科技", event_name:"2026年会"...}'
#   断言：201 + quote_no 形如 Q261104-01

# 6. 关键错误流（每条都必须验）
#   a) 同 item+supplier+nature+tax+区间重叠 → 409/23P01
#   b) 单位不可折算 → compare_state=not_comparable，is_lowest=false，行仍在
#   c) 跨税口径 → 该组 comparable=false reason=TAX_BASIS_MISMATCH
#   d) member PATCH /prices/:id → 403
#   e) member POST /prices 改 supplier_id → 422/42207
#   f) member 导出 internal → 403
#   g) 客户名空 → issue 阻断；客户名填了 → issue 200（即使负毛利）
#   h) 无价 → 42205 + other_basis_* 仅在错误体；**不得回填成本**

# 7. 界面走查（人工，5 分钟）
#   比价页：摘要条 / 性质 Tab / 最低价五重编码（不只靠颜色）
#   报价单：抽屉加项 → 改价 → 切换税口径看整单合计前后值 → 导出客户版确认零成本
```

**完成定义**：以上全部通过 + 232 条 TC 全绿 + `canvas` 里零成本字样（客户版断言）。

---

## 13. 变更记录

| 日期 | 变更 | 原因 | 影响 |
|---|---|---|---|
| 2026-11-04 | v1.0 生成并锁定 | 客户确认三文档 | 进入 Phase 2 |
| 2026-11-04 | §4.2 新增偏差 13–14（lockfile 与依赖冲突） | 首次远端 Docker 构建在 `npm ci` 失败：`effect` peer 冲突 + lockfile 不同步 | 移除两个零引用的表单依赖；打包前加 lockfile 同步门禁 |
| 2026-11-04 | §4.2 新增环境实测偏差 7 条 | 本机 Node 22 / 无 Docker / 无 pnpm / npm 缓存只读 / TypeScript 7 已是 latest | 技术栈版本重新锁定，包管理改 npm |
| 2026-11-04 | §4.2 追加偏差 8–12 条 | 实现期真实撞上的 5 条：Prisma 7 移除 datasource.url 且不读 .env；ORM 写不了生成列、给不出 23P01 语义；契约无 refresh 端点；内部账号无邮箱；折算系数方向含糊导致比价页全不可比 | 数据层改 pg 手写 SQL；会话改单 Cookie + 回库校验；字段统一 login/name；`base_unit_qty` 语义钉死为乘法并写进种子 |
