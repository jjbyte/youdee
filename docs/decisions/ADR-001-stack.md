# ADR-001: 采用 Next.js 全栈单体 + Prisma + PostgreSQL 作为系统技术栈

## Status

Accepted（2026-11-04）

## Background

客户是活动策划与执行公司，需要一套内部价格库 + 报价单系统，服务 3-10 人团队，电脑网页为主。数据量小（物料 2,000、价格 8 万条、报价单年数百），并发极低（峰值 5 个请求）。没有专职运维，只有 1 个人长期维护。

候选方案四个：

- A：Next.js 全栈单体（App Router + Route Handlers + Prisma + PostgreSQL），单 Docker 镜像
- B：React 19 + Vite 8 前端 SPA / NestJS 12 + Prisma 后端，双镜像
- C：React 19 + Vite 8 前端 SPA / Express 5 + Prisma 后端，双镜像
- D：低代码/表格类方案（Baserow / NocoDB / 飞书多维表格）

按本项目实际痛点加权（开发速度 25%、本场景匹配度 25%、运维成本 20%、后续扩展 10%、团队上手 10%、落地风险 10%）打分：A 4.55、B 3.90、C 3.60、D 3.10。

关键技术约束（这些约束决定了选型下限）：

1. 金额必须精确到 4 位小数（平方单价常见 12.3456 元/㎡），且明细加总必须恒等于合计
2. 同一供应商对同一物料的有效价格区间**不得重叠**，否则取价与比价结果不确定，且不会报错（沉默逻辑错误）
3. 报价单行必须是金额快照，供应商后续调价绝不能改动历史报价单
4. 报价单需要按 A4 打印给客户，中文

## Decision

采用 **方案 A**：

| 层 | 技术 | 版本 |
|---|---|---|
| 运行时 | Node.js | 24.x LTS |
| 框架 | Next.js | 16.4.2（App Router + Route Handlers） |
| UI 运行时 | React / React DOM | 19.3.1 |
| 样式 | Tailwind CSS | 4.3.3 |
| 组件 | shadcn/ui CLI | 4.19.x，基座锁定 Radix |
| 图标 | lucide-react | 1.64.0（全项目唯一） |
| ORM | Prisma | 7.10.x（CLI 与 client 同锁 7 线） |
| 数据库 | PostgreSQL | 18.6（btree_gist / pg_trgm / citext） |
| 部署 | Docker Compose | app + postgres + caddy 三容器 |

关键实现约束（写入架构文档 §11，由 ESLint `no-restricted-imports` 强制）：

- **REST-first**：所有业务逻辑实现在 `src/server/services/`，统一经 `/api/v1/*` 暴露。页面一律是 Client Component + TanStack Query。不使用 Server Components 的流式/缓存特性。
  - 理由：RSC 的心智负担是本方案唯一的短板（团队上手评分 3/5）。REST-first 让代码形态与普通 React SPA 一致，接手者无需理解 RSC 语义；同时保住 API 契约为一等公民，将来拆前后端时后端可原样搬走。
- 分层依赖单向：`route.ts → services → repositories → db`，反向与跳跃一律 lint 失败。

## Consequences

### 正面

- **单一部署单元**：一个容器 + 一个数据库容器 + 一个反向代理。备份是 `pg_dump` + `rsync` 两条命令。这是 10 人系统最合适的运维负荷。
- **PostgreSQL 直接解决两个最硬的技术点**：`numeric` 精确金额；`daterange` + `EXCLUDE USING gist` 把"价格区间不重叠"变成写入时立即失败的数据库约束（应用层校验会漏，并发和脚本导入都能绕过）。
- **无 CORS、无跨服务鉴权、无共享类型包**：省掉方案 B/C 约 15-20% 的样板代码。
- **类型贯通**：Prisma 生成的模型类型 + zod schema 前后端共用，字段改名时 TypeScript 编译期即可发现遗漏。
- **PRD 全部能力可落地**：比价、阶梯价、快照、趋势、打印，无一需要绕路。

### 负面

- **Next.js 版本迭代快，安全更新频繁**（2026-10-14 刚修复两个 Critical RCE）。缓解：`package.json` 锁精确版本（不带 `^`），Dependabot 仅对 `next` 提 PR，每月第一个周一为补丁窗口。
- **ExcelJS 维护低迷**（4.4.0 发布于 2023-10，仓库 2025-01 后无提交）。缓解：隔离在 `src/server/export/excel.ts` 单文件，对外只暴露 `buildQuoteWorkbook()`，可一次替换为 `@protobi/exceljs` 或 `excelize-wasm`。
- **Prisma 8 已进入 RC**，npm 上 `prisma@latest` 指向 8.0.0-rc，而 `@prisma/client@latest` 仍是 7.10.x，裸装会产生裂开的组合。缓解：显式锁 `prisma@7` 与 `@prisma/client@7`，使用 `prisma7.config.ts`（Prisma 7.10+ 专用文件名，避免与 8 的 `prisma.config.ts` 冲突）。
- **RSC 心智负担**：已通过 REST-first 约束消解，代价是放弃 Server Components 的首屏直读优化（本项目页面少、数据量小，收益可忽略）。
- **未选 NestJS**：若将来团队规模扩到 30 人以上、需要模块化约束与微服务拆分，迁移路径是"把 `services/` 目录搬进 Nest provider，`repositories/` 原样保留"。因为分层已经写死，这个迁移是机械的，不是重写。

### 被明确否决的方案

- **方案 D（低代码）**：场景匹配度仅 1/5。这类平台无法表达"价格区间不重叠"约束，也无法在写入报价单时固化不可变快照（关联字段永远实时 join，供应商一改价，去年发出的报价单金额跟着变）。它不是简化版实现，它做不了核心业务。
- **方案 B（NestJS 分离）**：为本项目承担 NestJS 12 的 ESM 迁移与 `@nestjs/config` 校验机制变更风险，收益（模块化约束）在一个 15 页面系统里体现不出来。
- **SQLite**：无 `DECIMAL`（只能整数存分或 REAL，平方单价 4 位小数会失真）、无 range 类型与 exclusion constraint、单写者锁。仅当客户要求"离线单机版"时作为备选。

## Related ADRs

- ADR-002：价格有效期与阶梯价建模（依赖本决策中 PostgreSQL 的 `daterange` 与 `EXCLUDE` 能力）
- ADR-003：报价单快照设计
