# ADR-002: 价格数据采用「单表 + 有效期闭区间 + 阶梯子表 + 交易性质分组 + 折算系数」建模

## Status

Accepted（2026-11-04 初版；同日按 PRD v1.1 §6.6 修订，修订点见文末「修订记录」）

## Background

系统要回答四类问题，且都要求结果确定、可复现：

1. 「某物料在某供应商处，2026 年 3 月 15 日、买 60 ㎡ 时，单价是多少？」（取价）
2. 「同一物料在 8 家供应商处的价格，谁最低？」（比价）
3. 「这个物料过去两年的价格怎么变的？」（趋势）
4. 「这个价 187 天没核过了，还能用吗？」（陈旧判定）

业务现实带来五个复杂性：

- **单位不一致**：同一物料的不同供应商用不同单位报价。喷绘布基准单位 ㎡，A 厂按「张」（12 张/㎡）报 5 元，B 店按 ㎡ 报 6.8 元。直接比 5 vs 6.8 会得出「A 便宜 9 倍」的错误结论。
- **交易性质不同**：同一个 LED 屏，淘宝买断 8,000 元、租赁商 500 元/天、定做厂 1,200 元/套。三者混排标「最低 500」会让报价员按租价报一个需要买断的活动，**一单亏几千**。
- **数量阶梯价**：「50 张以上 4.2 元/张」。
- **价格会变且有生效日**：调价不是立即生效，而是从某个日期起生效。
- **物料与人员都要有价格**，两者数据结构高度相似但业务属性不同。

候选建模方案：

| 方案 | 结构 | 问题 |
|---|---|---|
| 1. 表内单值 | `prices(item_id, supplier_id, unit_price)` 一条现价 | 无历史、无阶梯、无有效期。调价即覆盖，趋势与「当时价格」都无法回答 |
| 2. 两张表分离 | `material_prices` + `labor_prices`（各带 tiers 子表） | 比价/趋势/改价/审计四套逻辑写两遍，双倍维护与双倍出错面 |
| 3. 单表 + 多态 item_id | `prices(item_type, item_id, ...)` 无外键 | 无法建外键，参照完整性丢失，孤儿数据不可控 |
| 4. 单表 + 两个可空 FK + CHECK + 日期区间 | `material_id` / `labor_id` 二选一 | 一条 EXCLUDE 变两条、一条索引变两条、每次查询都要 `COALESCE(material_id, labor_id)`，约 +30% 核心表复杂度，换来的是「物料与人员分成两张主表」——而 PRD 已决定合表 |
| 5. **单表 + 单个 `item_id` 外键 + 有效期闭区间 + 交易性质** | 见 Decision | 无 |

## Decision

**采用方案 5。**

前提：PRD 决策 A 已确定「物料与人员合成一张 `items` 表，用 `item_type` 判别」（理由见 PRD §6.3，架构侧结论见 `02-ARCHITECTURE.md` §0）。方案 4 的双外键是为了解决「两张主表」的问题，前提不存在后它就是纯粹的复杂度负债。

### 表结构

```
prices
├── id                uuid PK
├── item_id           uuid NOT NULL → items(id) ON DELETE RESTRICT
├── supplier_id       uuid NOT NULL → suppliers(id) ON DELETE RESTRICT
├── unit_code         text NOT NULL        -- 本价格的计价单位（可能 != 主体的比价基准单位）
├── base_unit_qty     numeric(12,6) NULL   -- 1 个比价基准单位 = N 个本价格单位；NULL = 未填
├── pricing_nature    text NOT NULL                          -- 无默认值（ARCH §6.9 第 2 处）
│                     -- purchase | rental_per_day | custom_made
├── unit_price        numeric(14,4) NOT NULL  -- 基准档单价（无阶梯时即唯一价）
├── currency          char(3) NOT NULL DEFAULT 'CNY'
├── tax_included      boolean NOT NULL                       -- 无默认值（ARCH §6.9 第 1 处）
├── tax_rate          numeric(5,2) NULL    -- P1 才采集，MVP 建列不写
├── moq               numeric(12,3) NULL
├── effective_from    date NOT NULL
├── effective_to      date NULL            -- 【闭区间】含当天；NULL = 长期
├── status            text 'active' | 'superseded' | 'archived'
├── last_used_at      timestamptz NULL     -- 最近一次被 issued 报价单引用
├── source_note       text NULL
└── created_by        uuid NULL

price_tiers
├── price_id          uuid → prices(id) ON DELETE CASCADE
├── min_qty           numeric(12,3)        -- 档位起点（含），以【本价格计价单位】计
├── unit_price        numeric(14,4)        -- 档位单价，以【本价格计价单位】计
└── PRIMARY KEY (price_id, min_qty)        -- 天然防重复档位；max_qty 不入库（由下一档 min_qty 派生）
```

### 四条核心约束

```sql
-- 1. 闭区间合法（to 含当天，故允许 to = from）
CHECK (effective_to IS NULL OR effective_to >= effective_from)

-- 2. 折算系数为正（NULL 合法 = 未填）
CHECK (base_unit_qty IS NULL OR base_unit_qty > 0)

-- 3. 单位换算自洽（触发器）
--    unit_code = 主体 compare_unit_code  → base_unit_qty 必须为 NULL 或 1
--    unit_code <> compare_unit_code       → base_unit_qty 不得为 1（填 1 等于谎称单位一致）
CREATE TRIGGER trg_prices_base_unit_qty_check ...

-- 4. 同供应商同主体同交易性质，生效期间不重叠（数据库强制，并发安全）
CREATE EXTENSION btree_gist;
ALTER TABLE prices ADD CONSTRAINT prices_no_overlap
  EXCLUDE USING gist (
    item_id WITH =,
    supplier_id WITH =,
    pricing_nature WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (status <> 'archived');
```

**为什么 `pricing_nature` 必须进 EXCLUDE 键**：同一 LED 屏的买断价与租价是**同时有效**的两条记录。若唯一键不含这个维度，第二条永远插不进去，用户只能给租赁商建一条假供应商绕过去——那是数据模型逼着用户污染数据。

**为什么 `tax_included` 刻意不进 EXCLUDE 键**：一旦允许同 (主体, 供应商, 性质, 时段) 存在含税与不含税两条有效价，解析函数 `resolvePrice()` 就不再单值，出单时无法自动取成本，用户每次都得手动在两条里选。取舍：MVP 只允许一条，含税口径由该条记录声明；双口径报价的另一口径写进 `source_note`。P1 引入 `tax_rate` 具备反算能力后再放开（见 Consequences）。

### 五条配套规则

**规则 1：改价 = 关闭旧记录 + 新建记录，永不 UPDATE 金额。**

- `PATCH /prices/:id` 只允许改 `source_note` / `moq` / `tax_included` / 提前 `effective_to`；改金额/单位/折算系数/交易性质/期间一律 409 `PRICE_IMMUTABLE`。
- 调价在单事务内：旧记录 `effective_to = 新价 effective_from - 1 天` 且 `status='superseded'`，再插新记录。
- 用户语义是闭区间（「失效日当天仍有效」），数据库内部用 `daterange(from, to+1, '[)')` 表达，两边等价且不给 off-by-one 留缝。

**规则 2：所有跨供应商比较必须先折算到「比价基准单位单价」，口径统一为乘法。**

```
qty_priced     = 行数量(比价基准单位) × COALESCE(base_unit_qty, 1)   -- 换算成本价格的计价数量，据此选阶梯档
tier           = 满足 min_qty <= qty_priced 的最大一档（无阶梯用 unit_price）
base_unit_price = tier.unit_price × COALESCE(base_unit_qty, 1)        -- 折算为「元/比价基准单位」
金额            = round(行数量 × base_unit_price, 2)
```

两处都是乘法，全项目不出现除法。这不是风格偏好：除法让「乘/除写反」这类错误有机会发生，乘法不会。

**规则 3：三级可比性，未填系数不报错也不隐藏。**

| 条件 | `compare_state` | 是否参与标最低 |
|---|---|---|
| `unit_code = compare_unit_code`，或主体未设 `compare_unit_code` | `comparable` | 是 |
| 单位不一致，但 `base_unit_qty` 已填 | `converted` | 是（用折算后单价） |
| 单位不一致，`base_unit_qty` 为 NULL | `not_comparable` | **否**，但行仍返回、仍可加入报价单 |

`base_unit_qty` 是**选填**（PRD 明确要求，不进录价表单的 4 个必填）。填了则必须 `> 0` 且 `≠ 1`，否则 422 `42201`。

**规则 4：只在同一 `item_id` + 同一 `pricing_nature` 内比价，不同 SKU、不同交易性质永不比价。**

同组内若 `tax_included` 出现两种值，整组 `comparable=false` + `reason='TAX_BASIS_MISMATCH'`，不标最低——**给出一个错误的最低价，比不给最低价危险得多**。

**规则 5：价格状态四级全部查询时派生，不落库。**

| 派生 `effective_state` | 判定 | 比价 | 出单 |
|---|---|---|---|
| `valid` | 今天 ∈ `[from, to]` 且 `staleness_days <= 90` | 参与 | 可用 |
| `soft_stale` | 在有效期内但 `staleness_days > 90` | 参与 | 可用（仅提醒） |
| `hard_expired` | `effective_to < 今天` | 不参与 | 红色阻断，提示手填成本 |
| `superseded` | `status='superseded'` | 不参与 | 不可选，只进趋势 |

`staleness_days = 今天 - date(GREATEST(updated_at, last_used_at))`。计时起点取两者较大值：一个价 187 天没改但上周刚被用在报价单里且客户没异议，提醒它过期是纯噪音；用户一旦对提醒脱敏，真正的硬失效也会被忽略。

`last_used_at` 在 `POST /quotes/:id/issue` 的事务内回写（`UPDATE prices ... FROM quote_items WHERE quote_id = $1`，同库单表按主键更新，量级 = 单张单的行数 ≤ 50，不需要异步）。

## Consequences

### 正面

- **一个不重叠、连续、不可变的天然时间序列**。历史趋势直接查 `prices` + `price_tiers`，不需要额外的价格历史表，也不需要物化视图（单物料最坏 2,000 行，Index Scan 聚合 < 1ms）。
- **比价与趋势逻辑只实现一次**（物料与人员共用同一套 service/repo）。
- **单个真外键保住参照完整性**：不会出现「价格指向一个已删除的主体」的孤儿数据；比方案 4 少一条约束、少一条 partial index、查询不需要 `COALESCE` 拼 id。
- **取价结果单值**：因 EXCLUDE 含 `pricing_nature`，`(主体, 供应商, 性质, 日期)` 至多命中一条 active 记录，查询不需要 `DISTINCT ON`，也不会出现「两条都有效、取哪条看运气」。
- **交易性质把「会真金白银出事」的错误挡在结构层**：租价与买断价物理上无法进入同一个最低价计算，不依赖界面文案提醒。
- **改价留痕免费获得**：旧记录就是历史，`price_change_logs` 只承担「谁在何时做了什么操作」的审计职责。
- **报价单溯源成立**：`quote_items.price_id` 指向的记录永不变化，「当时价格」永远可举证。

### 负面

- **含税/不含税双口径无法并存**：解析函数必须单值，否则出单无法自动取成本。当前处理是只录实际会采用的那一口径，另一口径写 `source_note`。
  - 解除条件：P1 加上 `tax_rate` 采集后，可把 `tax_included` 纳入 EXCLUDE 键并做归一比较（届时才有反算能力）。改动面：一条迁移 + `resolvePrice` 的多值分支 + 比价页多一列。
- **不允许插入历史中间价**：新记录 `effective_from` 若早于已有记录会触发 EXCLUDE 冲突（40902）。历史只能追加在时间轴末尾。补录历史走离线脚本 `scripts/import-legacy-prices.ts`，不开放给日常操作。
- **`base_unit_qty` 依赖人工录入正确性**，是本设计最脆弱的输入点。缓解：强校验（`> 0`、`≠ 1`）、表驱动单测覆盖「张/㎡/延米/人天/场/半天」六种组合、变异测试（把 `× base_unit_qty` 改成 `÷` 必须导致测试变红）、`recalculate` 端点作为事后自洽性检查器。
  - 更根本的缓解：**这是客户的业务事实，我们填不了**（PRD R9）。拿不到就退化为规则 3 的 `not_comparable`——功能降级但可用，绝不报错。
- **阶梯价单调性不做数据库约束**（供应商可能出现「量大反而贵」）。服务层检测到非单调递减返回 `warning` 但不阻断写入。
- **软陈旧阈值 90 天是我们的估计，不是客户的事实**。因此做成 `app_settings.stale_days_threshold`，管理员可改，不硬编码。

### 被否决方案的具体原因

- **表内单值（方案 1）**：无法回答「过去两年怎么变」与「3 月 15 日那天什么价」。这是 PRD 的明确能力要求。
- **两张表分离（方案 2）**：比价、趋势、改价、审计四套逻辑的物料版与人员版几乎逐行相同。双份代码在半年后必然出现「改了一处忘另一处」的漂移。
- **多态 item_id（方案 3）**：失去外键意味着价格可以指向不存在的对象。对价格库来说这是不可接受的完整性损失——错的价格比没有价格更危险。
- **双可空外键（方案 4）**：它是「物料与人员分两张主表」的补丁。PRD 已选合表，前提不成立后它只剩成本。

## 修订记录

| 日期 | 修订 | 原因 |
|---|---|---|
| 2026-11-04 初版 | `material_id`/`labor_id` 双可空 FK + 半开区间 + `unit_factor`（倒数口径） | — |
| 2026-11-04 修订 | 改为单个 `item_id` 真外键 | PRD 决策 A 确定「物料与人员合表」，双 FK 的前提消失 |
| 2026-11-04 修订 | 区间由半开改为「对外闭区间 + 库内 `to+1` 半开表达」 | PRD 明确「失效日 = 新价生效日 - 1 天」，是闭区间语义 |
| 2026-11-04 修订 | `unit_factor`（除法）→ `base_unit_qty`（乘法） | PRD v1.1 §6.6.2。两个倒数口径同时存在是必出的符号错；乘法方向更抗错 |
| 2026-11-04 修订 | 新增 `pricing_nature` 并入 EXCLUDE 键 | PRD v1.1 §6.6.1。租价与买断价混排会直接造成报价事故 |
| 2026-11-04 修订 | 新增 `last_used_at` / 四级派生状态 | PRD v1.1 §6.6.4。软陈旧与硬失效必须分开，且软陈旧计时起点是 `max(updated_at, last_used_at)` |

## Related ADRs

- ADR-001：本决策依赖 PostgreSQL 的 `daterange` 类型、`btree_gist` 扩展与 `EXCLUDE` 约束能力（MySQL / SQLite 无法表达）
- ADR-003：报价单快照决策——`quote_items` 存的是本 ADR 中 `base_unit_price` 在某一时刻的计算结果，且永不回头重算
