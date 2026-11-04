# ADR-003: 报价单行采用「不可变金额快照 + 弱引用溯源」

## Status

Accepted（2026-11-04）

## Background

报价单是这套系统唯一对外的商务文档。一张 2026 年 3 月发给客户的报价单，2027 年被客户拿出来说「当时你报的是 84 元/㎡」，系统必须能拿出完全一致的记录。

业务上必然发生的事：

1. 供应商在报价单发出后调价（涨或跌）
2. 供应商改名、合并、停用
3. 物料改名、改规格描述、品类重组
4. 员工离职，`created_by` 指向的账号被停用
5. 客户要求「按上次那份改一下」→ 复制出新版本，旧版必须原样保留

如果报价单行的名称与单价靠 JOIN 实时取，上述任何一件事都会让历史报价单显示「不存在的价格和名字」。这类错误不抛异常、不进日志，只是安静地把一份商务文件改成了另一份内容——属于生成式代码失效模式里最贵的「沉默逻辑错误」。

同时还有反向需求：必须能回答「这行当时取自哪条价格记录」，用于和供应商对账、举证。所以不能简单地把引用全部切断。

## Decision

**报价单行 `quote_items` 冗余存储全部展示字段与计算字段，全部 `NOT NULL` 且无默认值；`item_id` / `price_id` 只作为可空、`ON DELETE SET NULL` 的溯源字段，不参与任何金额计算。**

### 表结构（关键列）

```
quote_items
├── quote_id              uuid NOT NULL  → quotes(id) ON DELETE CASCADE
├── sort_order            int  NOT NULL DEFAULT 0
├── line_kind             text NOT NULL  'material' | 'personnel' | 'custom'
├── pricing_nature        text NULL      'purchase' | 'rental_per_day' | 'custom_made'
│
├── ── 快照：展示字段 ──
├── item_name_snapshot    text NOT NULL      录单时的名称
├── spec_snapshot         text NULL          录单时的规格
├── category_snapshot     text NULL          录单时的分类名（打印分组用）
├── unit_snapshot         text NOT NULL      录单时的单位中文名
├── supplier_name_snapshot text NULL         录单时的供应商名
│
├── ── 业务数据 ──
├── qty                   numeric(12,3) NOT NULL   数量（比价基准单位）
├── cost_unit_price       numeric(14,4) NOT NULL   成本单价（比价基准单位）
├── sale_unit_price       numeric(14,4) NOT NULL   对客单价（比价基准单位）
│
├── ── 快照：计算字段（服务端算完落表） ──
├── line_cost             numeric(14,2) NOT NULL
├── line_price            numeric(14,2) NOT NULL
├── line_profit           numeric(14,2) NOT NULL
├── line_margin           numeric(6,4)  NOT NULL
│
├── ── 弱引用溯源（不参与金额计算） ──
├── item_id               uuid NULL → items(id)     ON DELETE SET NULL
├── supplier_id           uuid NULL → suppliers(id) ON DELETE SET NULL
├── price_id              uuid NULL → prices(id)    ON DELETE SET NULL
├── source_tier_min_qty   numeric(12,3) NULL   当时命中的阶梯档
├── price_effective_from  date NULL            当时价格的生效日
├── price_effective_to    date NULL            当时价格的失效日
│
└── ── 业务标记 ──
    cost_source            text NOT NULL                        成本来源：price_book | manual。无默认值（ARCH §6.9 第 3 处）
    reference_lowest_price numeric(14,4) NOT NULL              录单那一刻该主体同性质同口径下的最低有效价
    price_missing          boolean GENERATED ALWAYS AS
                             (cost_source = 'manual' AND price_id IS NULL) STORED
    is_visible_to_customer boolean NOT NULL DEFAULT true    客户版是否显示（隐藏内部行/赠送行）
    remark                 text NULL                        行备注（对客展示）
```

`cost_source` 与 `reference_lowest_price` 也是快照（PRD §6.6.8 R3 决议）：前者是 `manual_cost_line_ratio` 指标的**分母**，后者是「三个月后最低价变了，当时为什么没选最便宜的」的**唯一答案来源**。两者都只读本表，不做 JOIN 反查——否则价格一归档，这两列的含义就漂了。

### 五条实现铁律

**铁律 1：金额列全部 `NOT NULL` 且无默认值。**

这让「忘记快照、靠 JOIN 补」在数据库层面不可能——写入时必须显式提供每一个金额。Prisma 生成的类型同样会强制。**这是本 ADR 最重要的一条**：靠人的自觉去记得快照，一定会在第 200 张单上失效；靠 `NOT NULL` 无默认值，第一次就失败。

**铁律 2：任何查询/导出报价单的代码路径都不得 JOIN `prices` / `items` / `suppliers` 取展示字段或金额。**

只有 `price_id` 可以 JOIN，且仅用于「溯源」展示（「这行取自 2026-03-01 生效的甲供应商报价」），不用于重算金额。Code Review 硬性检查项；`src/server/repositories/quote.repo.ts` 之外的仓储不得出现 `quote_items` 与 `prices` 的联表。

**铁律 3：`price_id` / `item_id` 用 `ON DELETE SET NULL`，不用 `RESTRICT`。**

价格记录理论上不会被物理删除（只 `archived`），但若有人硬删，**历史报价单不能因此无法打开**。溯源信息可以丢，金额绝不能丢。

反过来若用 `RESTRICT`，会因为「有一张两年前的报价单引用过这条价」而永远删不掉一条录错的价格——把完整性保护做成了运维死结。

**铁律 4：金额列可重算验证——这是数据自洽性的检查器。**

`line_price = round(qty × sale_unit_price, 2)`、`line_cost = round(qty × cost_unit_price, 2)`、`line_profit = line_price - line_cost`、`line_margin = line_profit / line_price`（分母 0 时置 0）必须恒成立。`POST /quotes/:id/recalculate` 端点就是用这些恒等式校验历史数据。一旦发现不一致（说明某处写入绕过了 service 层），**立即报告而不静默修复**——静默修复会掩盖真正的 bug。

**铁律 5：草稿态与发出态由状态机区分「能不能改」，不靠 UI 隐藏按钮。**

只有三态（PRD §6.6.7 明确不加审批态）：

| 状态 | 行金额 | 行名称/数量 | 说明 |
|---|---|---|---|
| `draft` | 可改 | 可改 | 允许 `refresh-prices` 主动把草稿行同步到最新价（显式操作、需二次确认） |
| `issued` | **只读（API 409 `QUOTE_LOCKED`）** | 只读 | 服务端硬拦，不依赖前端置灰。要改只能 `new-version` 生成 `version+1` 的新草稿 |
| `void` | 只读 | 只读 | 作废单保留原值，供追溯 |

状态判断只准走 `src/domain/quote-status.ts`（架构文档 §11.2 R11）——将来若加 `pending_review`，只改一处。

### 为什么 `pricing_nature` 也要快照

它是**展示与校验的双重输入**：客户版打印要按性质分组（「租赁价·按天」），`risk-check` 的 R3（成本高于该主体同性质最低价）也要用它做同性质比较。若这一列从 `prices` 实时 JOIN 取，就会出现「价格被归档后，历史单的分组标签变成 NULL」——这正是铁律 2 要防的形态。

### 冗余 `supplier_name_snapshot` / `category_snapshot` / `unit_snapshot` 而不是 JOIN 的理由

供应商改名、品类重组是常见操作。若历史报价单显示「改名后的新名字」，客户手上的 PDF 与系统内的记录就对不上——这是审计事故，不是显示问题。同理 `unit_snapshot` 也必须快照：如果将来把 `sheet` 的中文名从「张」改成「片」，历史报价单不能跟着变。

## Consequences

### 正面

- **历史报价单永不变形**。供应商调价、改名、停用，物料改名，品类重组，员工离职——任何一项都不影响已发出报价单的一个字符。
- **导出与打印零依赖**：Excel 与打印页只读 `quote_items` 一张表，不做多表 JOIN，也就没有「JOIN 漏了一行导致明细缺失」的风险。这条对**客户版成本剥离**尤其关键：单表读取意味着「裁掉哪些字段」是一个显式白名单，可被断言验证（架构文档 §6.6 的自检断言）。
- **性能**：单表读取，70,000 行的表加 `(quote_id, sort_order)` 索引，一次查询出全部行。
- **可举证**：`price_id` + `price_effective_from` + `price_effective_to` 三个字段合起来，能回答「报价时该价格是否有效」。这是商务纠纷时最有用的证据。
- **数据自洽性可机器验证**：铁律 4 的四个恒等式让「绕过 service 直接写库」的错误能被自动发现。

### 负面

- **数据冗余**。同一物料在 20 张报价单里出现，`item_name_snapshot` 存 20 份。存储成本可忽略（70,000 行 × 几十字节 ≈ 5MB），换来的是正确性。
- **物料改名后，新报价单与旧报价单显示不同名字**。这是**期望行为**，不是 bug。若需要「当前名称」，从物料详情页看。
- **追溯链断裂风险**：若 `price_id` 指向的价格被硬删，溯源信息丢失（金额仍在）。通过「价格只归档不删除」的业务约定 + `ON DELETE SET NULL` 兜底。
- **`refresh-prices` 是唯一能改写已落表快照的操作**，且仅在 `draft` 态可用。这是一个有意的逃逸口：草稿阶段价格变动频繁，逐行手改体验太差。实现上必须二次确认 + 返回 `updated[]` / `skipped[]` 明细，让用户看到改了什么。
- **快照让「批量改价」无法回溯生效**：如果 50 张草稿都引用了某条价，改价不会自动更新它们（只有显式 `refresh-prices` 才会）。这是刻意的不便——自动更新草稿会让「我明明看过这张单」失去意义。

### 与 ADR-002 的关系

ADR-002 的 `base_unit_price` 是一个**函数**（随供应商报价与折算系数变化）。ADR-003 的 `quote_items.cost_unit_price` 是该函数在某个时刻的**取值**并永久固化。

两者的分工：ADR-002 保证「现在的价格算得对」，ADR-003 保证「过去的价格改不了」。缺任何一个，系统都会在最关键的地方出错——前者错了比价失准，后者错了历史失真。

### 被否决的方案

- **纯引用（只存 `item_id` + `price_id`，金额实时 JOIN）**：供应商一调价，去年发出的报价单金额全变。这是商务事故，不可接受。
- **纯快照（不留任何引用 ID）**：无法回答「当时取自哪条价格」，对账与举证断链。
- **快照 + 在报价单上存完整 JSON（把所有行打包成一个 JSONB 列）**：无法按行查询/统计（「这个物料今年报了多少次」要做 JSON 展开），也失去列级约束与索引。行级明细就该是行。
- **金额列允许 NULL，读取时回退 JOIN 现价**：看起来「更灵活」，实际是把「快照缺失」变成一个永远不被发现的隐性降级。`NOT NULL` 无默认值的严格性在这里是资产，不是障碍。

## Related ADRs

- ADR-002：报价单行的 `cost_unit_price` 是价格模型折算单价在写入时刻的固化值；`source_tier_min_qty` 记录当时命中的阶梯档；`pricing_nature` 记录当时采用的交易性质
- ADR-001：快照策略与具体框架无关，但在本项目中由 `quote.service.ts` 单点保证（所有行写入必须经过该 service）
