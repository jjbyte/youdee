# 03 · UI/UX 设计系统与页面方案

> 项目：**「有底」** —— 活动策划公司内部的价格底账系统（物料 / 人员 / 供应商 / 攒单报价）
> 设计师：颜好看 | 阶段：**Phase 1 已冻结** | 版本：**v1.7.2**（v1.7 之后仅做**接口真值对齐**：函数名/枚举值/接口契约，见 §K 末四条；已与 01-PRD.md v1.8 + 01a 验收用例 + 架构 `02-ARCHITECTURE.md` / `openapi.yaml` 逐条对齐）
> 设计寄存器：**Product（工具型）** —— 设计服务产品，标杆是"赢得熟悉感"，不是"制造惊喜"
> 平台轴：**web / desktop-first**（1280–1920，向下兼容 1024）
> 三轴刻度：`DESIGN_VARIANCE = 3` / `MOTION_INTENSITY = 3` / `VISUAL_DENSITY = 8`
> 说明：Variance 3 是因为工具类界面可预测性 > 新奇感；Density 8 是因为用户是"被 Excel 折磨的人"，一屏信息量就是效率；Motion 3 是因为任何动效只要拖慢一次录入，就会被骂。

---

## A. 设计语言定义

### A.1 竞品与对标调研（真实调研结论）

| # | 参考对象 | 看它的什么 | 结论：抄什么 / 不抄什么 |
|---|---|---|---|
| 1 | **Stripe Dashboard** | 金额表格、结算明细、多币种对账 | **抄**：金额一律 `tabular-nums` + 右对齐 + 列宽固定；表头用 12px 大写小字 + 弱色；一屏内所有可比较数字同列对齐。<br>**不抄**：Stripe 的品牌渐变与营销装饰，内部工具不需要。 |
| 2 | **Linear** | 高密度列表、键盘优先、4px 节奏 | **抄**：4px 全量对齐网格；13/14px 密集字号；单字母快捷键（`N`/`/`/`?`）+ `⌘K` 命令面板；hover 才出现的行内操作；乐观更新（改价即时上屏，失败回滚）。<br>**不抄**：**默认深色**。Linear 深色是"我是给开发者用的"的品牌信号；本项目用户是报价员/采购/老板，在明亮的办公室打印和投屏，深色反而降低信任。 |
| 3 | **Airtable / Notion 数据库视图** | 一模型多视图、字段类型化 | **抄**："一份数据，多套视图"——比价页可以切「卡片视图 / 表格视图」；字段有类型（金额、单位、日期）；可切换列可见性。<br>**不抄**：无边界自由度。本系统字段是固定的，不给用户自己搭表，防止又变回 Excel。 |
| 4 | **进销存 / 供应商管理系统**（如管家婆、聚水潭类） | 供应商档案、价格台账 | **抄**：供应商档案必须有"结算方式/账期/最后更新时间/信用备注"四个字段，这是采购真正会看的。<br>**不抄**：左侧 30 项折叠菜单、弹窗套弹窗、每页 8 个统计卡片的"数据大屏"套路。 |
| 5 | **活动行业报价工具**（云报价等） | 物料库 + 模板 + 一键出单 | **抄**：物料按"活动要素"分类（舞美硬体/灯光音响/演艺人员/印刷物料/场地）；报价单支持从历史单复制。<br>**不抄**：移动端优先 + 竖屏卡片流。本项目是电脑端密集录入，卡片流会浪费 70% 横向空间。 |
| 6 | [数据表格设计惯例（阿里/百度系 B 端规范）](https://www.51zxw.net/TechArticleDetails.aspx?id=781) | 表格密度、对齐、冻结列 | **验证**：文本左对齐 / 数字右对齐 / 金额固定小数位；宽表固定首列 + 表头；斑马纹价值有限，行 hover 更重要；行高提供"紧凑/标准"两档。 |

### A.2 最终对标品牌

**主对标：Stripe Dashboard（金额表格工艺） + Linear（密度与键盘）**
取舍理由：本系统的成败只在两件事上——**数字比得清不清楚**（Stripe 的强项）和**录得快不快**（Linear 的强项）。品牌调性反而是次要的，因为用户不会向任何人展示这个系统。

**排除：Linear 的深色默认。** 理由已在上表；且 2024 WebAIM 审计显示 83.6% 首页存在对比度失败，深色主题是重灾区。本系统选浅色为主 + 深色作为可选皮肤。

### A.3 五条设计原则（针对"数据密集型内部工具"）

1. **数字优先于装饰**
   屏幕上每个金额都必须能与同列的其它金额直接比较：`tabular-nums` + 右对齐 + 固定小数位 + 单位只在列头出现一次。没有任何装饰元素可以与数字争夺视觉重量。

2. **一屏定论**
   做决策需要的信息不允许进二级页面。比价必须在同一屏完成；毛利必须在录入时实时可见；"这个物料上次什么价"要在物料名旁边就能看到。**取消一切"点进去看看"的设计。**

3. **颜色即钱的语义**
   颜色不是风格，是编码。全系统只有四个颜色含义：绿 = 在钱上占优（最低价 / 正毛利）、朱砂 = 现在需要你动手（主操作 / 当前选中）、琥珀 = 数据有风险（价格陈旧 / 单位不一致 / 缺报价）、红 = 再往下走要出事（负毛利 / 价格失效 / 删除）。任何纯装饰用色都是 bug。

   **v1.2 新增硬约束：颜色含义必须由「形态」二次加固，不能只靠色相。**
   朱砂与危险红同属红色家族，只靠色相差在小屏和色觉障碍下不可靠（详见 §B.2.1）。因此：
   - **朱砂 → 只做填充**：按钮底、选中态底、focus ring、2px 强调描边
   - **危险红 → 只做文字形态**：文字、16/20px 图标、1px 细描边、角标、提示条底
   - 两者**永不出现在同一形态层级**（不存在"红色填充按钮 vs 朱砂填充按钮"并排的情况）
   - 该约束已写进 token 层：填充用 `--danger-fill`，文字用 `--danger`，误用会被 code review 抓住

4. **编辑即保存，撤销优于确认**
   报价单里改一个数量就是改一个数量，不弹"确定要修改吗"。自动保存草稿，误操作靠撤销（`⌘Z`）+ 30 天回收站兜底，而不是靠打断人的确认框。确认框只留给不可逆、影响面大的操作（删供应商、改基准单位）。

5. **不报错的错误才是危险的**（v1.5 新增，PM 抽出的通用判据）
   **会报错的错误是安全的，不报错的错误才是危险的。** 凡是"两个值都合法、都能算出一个数、但其中一个是错的"的地方，界面必须**强制二选一或显式确认，绝不允许静默使用默认值**。
   本产品共有五处符合这条判据，一处都不能"取个默认值先算着"：① 含税口径 ② 交易性质 ③ 计价方式 ④ 折算系数 ⑤ `cost_source`。它们的共同形态是：**选错了不报错，只是数字变得更好看**——而"更好看"正是没人会去查的原因。
   这条判据对我的具体要求：**凡是我不确定某个默认值会不会算错的地方，就不给默认值，改成让用户选一次。** 多一次点击换掉一整类静默错误，是划算的。

6. **密度可调，默认就紧**
   默认表格行高 36px、正文 13px，一屏 1280×800 可见 18–20 行。同时提供「紧凑 32px / 标准 36px / 宽松 44px」三档密度切换并记住选择——因为有人 42 岁近视、有人刚毕业。这是唯一允许用户改的视觉属性。

### A.4 视觉基调

- **主题**：浅色为默认（`[data-theme="light"]`），深色作为可选皮肤（`[data-theme="dark"]`），默认跟随系统但可在设置里锁定。
- **表面策略**：纸感但不米黄。背景 `#F7F8FA`（冷调近白灰），卡片纯白 `#FFFFFF`，靠 1px 边框分层，不靠阴影堆叠。**明确拒绝**奶油/米色 warm-neutral 背景——那会立刻变成 2026 年的 AI 模板色。
- **色彩策略**：中性色占 88%，朱砂（`#D2431F`）占 ≤8%，语义色 ≤4%。每屏可见的朱砂使用点 **≤2 处**（通常：1 个主按钮 + 1 个当前选中项）。
- **对比策略**：主文本 **16.77:1**（墨 `#14181D` 于纸白 `#F7F8FA`），次级文本 5.64:1，表格数字 16.77:1，白字于朱砂 4.60:1。所有正文与按钮文字 ≥ 4.5:1，已逐对实测（见 §B.2.1，10 组全部标实际值）。
- **禁止**：渐变、发光、毛玻璃、卡片左侧彩条、圆角 ≥16px 的大卡片、emoji 图标、**朱砂作为文字色**（4.33:1 不达标，链接一律走 `--link-fg`）。
- **不得因为换了墨黑就降低密度**：本方案的危险不是"太土"，是"为了高级感把行高放大、列数砍少"。**行高 36px / 表格 13px / 13 列** 是硬底线，任何"留白气质"的理由都不能突破它。

### A.5 信息密度策略（具体数值，前端可直接落）

| 项目 | 数值 | 说明 |
|---|---|---|
| 页面基准字号 | **14px** | 表单、正文、按钮 |
| 表格正文 | **13px**（默认）/ 14px（宽松档） | 中文 13px 在 1280 宽度下仍清晰，且一行能塞下 12 列 |
| 表格行高 | **36px** 默认 / 32px 紧凑 / 44px 宽松 | 表头 36px 与默认行高一致，视觉上"表头和行是一体的" |
| 表格单元格内边距 | 上下 0（靠行高撑开）/ 左右 **12px** | 数字列左右 12px，保证小数点对齐边距一致 |
| 表头 | 12px / 字重 510 / `letter-spacing: .02em` / 色 `#5A6473` / 底色 `#F1F3F5` | 不加粗到 700，密表里 700 会形成视觉噪点 |
| 行分隔线 | 1px `#EBEEF1` | 只在行之间，不加竖线（竖线会把 12 列切成碎片） |
| 页面外边距 | **24px**（<1440）/ 32px（≥1440） | 紧凑工具的呼吸感来自边距而不是留白 |
| 区块间距 | 24px；卡片内边距 16px | — |
| 侧边栏 | **216px**，可折叠至 56px | 折叠状态只留图标 + tooltip |
| 顶栏 | **52px** | 只放页面标题、面包屑、全局搜索、账号 |
| 内容最大宽 | **1600px** | 1920 屏左右各留白，不无限拉伸表格 |
| 报价单编辑器 | 左抽屉 320px / 底栏 60px / 明细区自适应 | 1280 屏时明细区仍有 ≥900px，可容纳 11 列 |
| 金额字号 | 13px（表格）/ 16px（汇总）/ 22px（合计） | 汇总数字用 22px 590 |

---

## B. Design Token（四层架构：A1-identity / A1-structure / A2 / B-slot / C-extension）

> **唯一真源**：`design-system/design-tokens.json`（机器可读，前端 import）+ `design-system/design-tokens.css`（CSS 变量）。
> 本节为人类可读副本，两者内容一致。**任何页面禁止出现裸 hex，全部走 `var(--*)`。**

### B.1 颜色 · 中性灰阶（9 档）

| Token | Hex | 用途 | 对比度（白底） |
|---|---|---|---|
| `--gray-50` | `#F7F8FA` | 应用背景 | — |
| `--gray-100` | `#F1F3F5` | 表头底 / 分组底 / 悬停底 | — |
| `--gray-200` | `#E3E6EB` | 边框（默认） | — |
| `--gray-300` | `#CDD3DB` | 强边框 / 禁用描边 | — |
| `--gray-400` | `#A8B0BC` | placeholder、禁用文字 | 2.4:1（仅非文本） |
| `--gray-500` | `#7A8493` | 图标弱色、meta 辅助 | 3.78:1（仅 ≥3:1 场景） |
| `--gray-600` | `#5A6473` | 次级文本 / 表头文字 | **5.99:1** 达标 |
| `--gray-700` | `#3B4453` | 次级标题 | **9.55:1** 达标 |
| `--gray-800` | `#262D38` | 标题 | — |
| `--gray-900` | `#14181D` | 主文本 / 品牌墨色（chrome） | **16.9:1** 达标 |

### B.2 颜色 · 品牌与语义

| Token | Hex | 语义 | 使用约束 |
|---|---|---|---|
| `--ink` | `#14181D` | 品牌墨色：侧边栏底、Logo 区、主标题 | 大面积使用（侧边栏） |
| `--ink-hover` | `#272A31` | 墨色悬停 | — |
| `--accent` | `#D2431F` | **朱砂**：主按钮、当前选中行标记、focus ring | **每屏 ≤2 处可见** |
| `--accent-hover` | `#B8371A` | 悬停 | — |
| `--accent-active` | `#9C2D14` | 按下 | — |
| `--accent-subtle` | `#FDF1ED` | 选中行底色 / 激活导航底 | 唯一允许的强调色大面积用法 |
| `--accent-border` | `#F3C9BC` | 选中行描边 | — |
| `--success` | `#15803D` | **有效且占优**：最低价、正毛利、有有效价 | 纸白 **4.72:1** 达标 |
| `--success-subtle` | `#F0FDF4` | 最低价卡片/单元格底 | — |
| `--success-border` | `#BBF7D0` | 最低价卡片/单元格描边 | — |
| `--warning` | `#A16207` | **需留意**：价格陈旧、单位不同、起订量不满足、档位断档 | 纸白 **4.63:1** 达标，余量仅 0.13 → **只用于 ≥12px 的文字/图标/描边，11px 小字一律改用 `--fg-2`** |
| `--warning-subtle` | `#FEFCE8` | 风险单元格底 | — |
| `--danger` | `#8C1A11` | **后果**：负毛利、价格失效、成本倒挂、删除（**仅文字/图标/细描边/角标**） | 纸白 **8.70:1** 达标 |
| `--danger-fill` | `#8C1A11` | **唯一的红色填充**：删除/作废按钮底（白字 **9.25:1**） | 与 `--danger` 同值，但语义独立，防止被当成通用红用去当底色 |
| `--danger-on` | `#FFFFFF` | 危险填充上的文字 | — |
| `--danger-subtle` | `#FEF3F2` | 缺价行底、负毛利单元格底 | — |
| `--danger-border` | `#FECDCA` | 缺价行描边 | — |
| `--link-fg` | `#0E7490` | **链接**（不叫 `--info`，因为它的职责是"可点"） | 纸白 **5.04:1** 达标 |
| `--info` | `#0E7490` | 中性提示、帮助、图表第 3 色 | 纸白 **5.04:1** 达标 |
| `--info-subtle` | `#ECFEFF` | 提示条底 | — |

**朱砂与危险红的关系（v1.2 按 PM 硬约束重做，这是本轮最实的一处修正）**

PM 指出"朱砂本身就是红偏橙，只靠色相区分在色觉障碍和小屏上不可靠"，这个判断成立——在红绿色盲（deuteranopia / protanopia）眼里，两者的色相差异几乎归零，**能用来区分的只剩明度和形态**。所以约束变成三条，全部是硬性的：

| # | 约束 | 具体规则 | 落地手段 |
|---|---|---|---|
| 1 | **形态隔离** | 朱砂**只做填充**（按钮底/选中底/focus ring/2px 强调描边）；危险红**只做文字形态**（文字/图标/1px 细描边/角标/提示条底） | 两者永不出现在同一形态层级——全系统不存在"朱砂填充按钮"与"红色填充按钮"并排的画面。token 层物理隔离：`--accent`（填充族）vs `--danger`（文字族）+ `--danger-fill`（唯一填充例外，只给删除/作废） |
| 2 | **明度差 ≥ 18（L\*）** | 实测：朱砂 `#D2431F` **L\* = 49.27**；危险红 `#8C1A11` **L\* = 30.29**，差 **18.98** | 上一版的危险红是 `#B42318`（L\* 39.53），与朱砂只差 **9.74**，本就不达标——已按 PM 要求往下压一档 |
| 3 | **填充色不得靠明度区分** | 深色皮肤下明度关系反转（危险色必须比行动色更亮）：`#FFB4AB` L\* 80.09 vs `#F0603C` L\* 59.17，差 20.92 | 深色皮肤同样是 ≥18，只是方向相反 |

> **为什么危险红一定要变深，而不是把朱砂变浅**：白字在朱砂底上已经是 **4.60:1**（余量只有 0.10），朱砂再浅一点按钮文字就不达标了。朱砂被"白字可读"这条锁死，所以只能把危险红往下压。**这不是审美选择，是两条硬约束的交点。**
>
> **朱砂按钮的 hover / active 绝对不许变亮（PM 补充的坑，我认了）**：白字在朱砂上只有 **4.60:1，余量 0.10**——**任何 5% 的白色叠加都会把它打到 4.5 以下**。而前端做悬停态的默认手法就是调亮（`filter: brightness(1.1)` / 混白）。所以 hover 一律**压深**（`--accent-hover: #B8371A`，白字 5.83:1）、active 再压深（`--accent-active: #9C2D14`，7.50:1），要"轻一点"的观感用**阴影或描边**，不许动亮度。
>
> **代价我也写清楚**：`#8C1A11` 已经接近"暗红/oxidized red"，在灰度打印里和深灰文本（`--gray-700` L\*28.61）几乎同明度。所以危险红**永远必须带图标或文字**（`负毛利` / `已失效` / `circle-alert`），不能只靠颜色——这条本来就是 WCAG 1.4.1 要求的，现在多了一个理由。

**语义色四级模型（v1.2 定稿：颜色 + 形态双编码）**

| 级别 | 颜色 | 形态（PM 约束） | 含义 | 必须出现的位置 | 是否阻断 |
|---|---|---|---|---|---|
| **占优** | 绿 `#15803D` | 文字 + 徽章底（弱填充） | 有效 + 占优：最低价、正毛利、有有效价 | 最低价卡片、毛利数字、摘要条 | 否 |
| **行动** | 朱砂 `#D2431F` | **填充**（按钮 / 选中态 / focus ring） | 需要你现在动手 | 每屏 ≤2 处 | — |
| **留意** | 琥珀 `#A16207` | 文字 + 图标 + 浅底提示条 | 数据可能不可信：价格陈旧、单位不同、起订量不满足、档位断档 | 卡片角标、行内提示条 | 否（可继续，留痕） |
| **后果** | 红 `#8C1A11` | **文字 / 图标 / 细描边 / 角标**（填充只走 `--danger-fill`） | 再往下走要出事：负毛利、价格失效、删除 | 缺价行、汇总条、危险按钮 | 见 §C.7（**只阻断"没填成本"，不阻断"毛利低"**） |

> **为什么红既表示"亏钱"又表示"阻断"**：它们的情感指向是同一个——"再往下走就要出事"。合并成一个颜色降低学习成本。约束是二者永不**同屏竞争**：毛利为负是数字（行内），"无有效价"是整行底 + 输入框，二者视觉层级不同。
>
> **与 PRD v1.0 建议的差异说明（PM 已在 v1.1 采纳）**：PM 原建议「绿=有有效价 / 红=过期或缺失 / 琥珀=即将到期」。我采纳这个**严重度分级**，但把"过期"拆成两级：**已过有效期 = 红**，**超过阈值未核价 = 琥珀**。理由：如果 90 天未更新就标红，一个正常运营的公司会满屏飘红，红色随即失效，真正致命的"这个价已经失效"反而被稀释。

最低价与正毛利同用绿色是**故意的**：它们在业务上是同一件事（"钱上占优"），共用一套色彩编码降低学习成本。

### B.2.1 对比度核查表（PM 要求的交付物，10 组实测）

> 计算方法：sRGB → 线性 → 相对亮度 Y → 对比度 `(Y1+0.05)/(Y2+0.05)`；L\* 用 CIE Lab 标准式。**所有值都是脚本算出来的，不是估的**，PM 或架构师可用任意工具复核。

| # | 前景 | 背景 | 对比度 | 结论 | 用在哪 |
|---|---|---|---|---|---|
| 1 | 墨 `#14181D` | 纸白 `#F7F8FA` | **16.77:1** | 达标（≥4.5） | 全站正文、表格数字 |
| 2 | 次级文本 `#5A6473` | 纸白 `#F7F8FA` | **5.64:1** | 达标 | 表头、说明文字、11px 辅助信息 |
| 3 | 白 `#FFFFFF` | 朱砂 `#D2431F` | **4.60:1** | 达标（**余量 0.10**） | 主按钮底 + 白字。因此主按钮文字**不得小于 14px / 590**，也**不得叠 opacity** |
| 4 | 白 `#FFFFFF` | 危险填充 `#8C1A11` | **9.25:1** | 达标 | 删除/作废按钮 |
| 5 | 危险红 `#8C1A11` | 纸白 `#F7F8FA` | **8.70:1** | 达标 | 负毛利数字、`已失效`、错误文案 |
| 6 | 琥珀 `#A16207` | 纸白 `#F7F8FA` | **4.63:1** | 达标（余量 0.13） | 陈旧/风险提示。**11px 及以下不用它** |
| 7 | 绿 `#15803D` | 纸白 `#F7F8FA` | **4.72:1** | 达标 | 最低价、正毛利 |
| 8 | 朱砂 `#D2431F` | 纸白 `#F7F8FA` | **4.33:1** | **不达标** | **禁止这个组合**：朱砂永远不做文字色。链接改 `--link-fg`（5.04:1），强调文字改 `--fg` + 字重 |
| 9 | 朱砂 `#D2431F` | 危险红 `#8C1A11` | **L\* 差 18.98** | 达标（≥18） | 两者并排场景下的可分辨性 |
| 10 | 危险红 `#8C1A11` | 危险底 `#FEF3F2` | **8.51:1** | 达标 | 缺价行内的红字（红字压在自己那层浅底上） |

> **第 8 组是这张表里唯一"不达标"的一行，但我的处理不是改颜色，是禁止这个组合。** PM 的表里列了「朱砂字/纸白底」，我做不出来，原因是硬性的：朱砂必须够深才压得住白字（4.60，余量 0.10），它就必然在纸白上做文字不达标（4.33）。**与其加一个 5.5:1 的"朱砂深一档"造出第三种红，不如承认"朱砂是填充色不是文字色"**——这也正好让 PM 的形态隔离规则更干净：红族里只有两个角色，一个填充、一个文字。链接和行内强调走 `--link-fg` / `--fg`，视觉上反而更像正经后台。


### B.3 颜色 · 表格专用（C-extension，本项目专属）

| Token | Hex | 说明 |
|---|---|---|
| `--table-header-bg` | `#F1F3F5` | 表头底色 |
| `--table-header-fg` | `#5A6473` | 表头文字 |
| `--table-header-border` | `#E3E6EB` | 表头下边线 1px |
| `--table-row-border` | `#EBEEF1` | 行分隔线 1px |
| `--table-row-hover` | `#F7F8FA` | 行悬停底 |
| `--table-row-selected` | `#FDF1ED` | 勾选行底（= accent-subtle） |
| `--table-row-selected-border` | `#F3C9BC` | 勾选行描边 |
| `--table-cell-num-fg` | `#14181D` | 数字主色 |
| `--table-cell-num-muted` | `#A8B0BC` | 缺失值「—」 |
| `--table-zebra` | `#FBFBFC` | 斑马纹（**默认关闭**，设置可开） |
| `--table-sticky-col-bg` | `#FFFFFF` | 冻结列底色（必须不透明） |
| `--table-sticky-col-shadow` | `inset -8px 0 8px -8px rgba(20,24,29,.10)` | 冻结列右侧阴影 |
| `--table-sticky-header-shadow` | `0 4px 8px -4px rgba(20,24,29,.10)` | 表头吸顶阴影 |
| `--table-cell-padding-x` | `12px` | |
| `--table-row-height` | `36px` | 32 / 36 / 44 三档由 `data-density` 切换 |

### B.4 字体

```css
/* 中英混排：Inter 承担拉丁与数字，Noto Sans SC 承担中文。
   Inter 提供 tnum（等宽数字）——这是本系统的命脉，不能换成没有 tnum 的字体。 */
--font-sans: "Inter", "Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
/* 仅用于编号/单号/ID，不用于金额（等宽字体在中文界面里宽度失配，反而更丑） */
--font-mono: "JetBrains Mono", "SF Mono", Consolas, monospace;
/* 数字专用：与 sans 同族，开启 tnum */
--font-num: "Inter", "Noto Sans SC", sans-serif;
```

**Google Fonts 引入**（`display=swap`，子集化后约 46KB）：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
```

**字号阶梯（8 级，px）**

| Token | px / rem | 行高 | 字重 | 用途 |
|---|---|---|---|---|
| `--text-2xs` | 11 / 0.6875 | 14 | 510 | 徽章、单位、极简标签 |
| `--text-xs` | 12 / 0.75 | 16 | 510 | 表头、辅助说明、时间戳 |
| `--text-sm` | 13 / 0.8125 | 20 | 400/510 | **表格正文、密集列表（主力字号）** |
| `--text-base` | 14 / 0.875 | 22 | 400 | 表单、正文、按钮 |
| `--text-md` | 16 / 1.0 | 24 | 510 | 区块标题 |
| `--text-lg` | 18 / 1.125 | 26 | 590 | 页面标题 |
| `--text-xl` | 22 / 1.375 | 28 | 590 | 汇总合计数字 |
| `--text-2xl` | 28 / 1.75 | 34 | 590 | 登录页标题、空状态主标题 |

**字重（3 级 + 1 备用）**

| Token | 值 | 用途 |
|---|---|---|
| `--fw-regular` | 400 | 正文、表格内容 |
| `--fw-medium` | 510 | 表头、按钮文字、小标题、强调数字 |
| `--fw-semibold` | 590 | 页面标题、合计金额 |
| `--fw-bold` | 700 | 仅 Noto Sans SC 中文标题（Inter 不用 700） |

> 用 510/590 而非 500/600：Inter 的可变字体在 510 上比 500 更"稳"，中文 Noto 在 590 上不会糊成一坨。这是本系统的工艺细节。

**字距**

| 场景 | `letter-spacing` |
|---|---|
| 正文（13–14px） | `0` |
| 小字（11–12px） | `0.01em` |
| 表头（12px，中文） | `0.02em` |
| 全大写英文标签 | `0.08em` |
| 页面标题（18px） | `-0.01em` |
| 展示数字（28px+） | `-0.02em` |
| **所有数字** | `0`（tabular-nums 已保证宽度一致，再加字距会破坏对齐） |

### B.5 间距（4px 基准）

```css
--space-0: 0;     --space-1: 2px;   --space-2: 4px;   --space-3: 8px;
--space-4: 12px;  --space-5: 16px;  --space-6: 20px;  --space-7: 24px;
--space-8: 32px;  --space-9: 40px;  --space-10: 48px; --space-11: 64px;
```
> 允许值仅：2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64。禁止 6 / 10 / 14 / 18 / 22 / 30 等非标值。

### B.6 圆角 / 阴影 / 边框 / 动效

```css
/* 圆角 —— 内部工具要利落，最大 12px */
--radius-xs: 2px;    /* 徽章、标签 */
--radius-sm: 4px;    /* 小按钮、输入框内元素 */
--radius-md: 6px;    /* 按钮、输入框、单元格编辑态 */
--radius-lg: 8px;    /* 卡片、面板 */
--radius-xl: 12px;   /* 弹窗、大面板（上限） */
--radius-full: 9999px; /* 头像、开关、计数徽章 */

/* 阴影 —— 只用 4 级，无发光 */
--shadow-1: 0 1px 2px rgba(20,24,29,.06);
--shadow-2: 0 2px 8px rgba(20,24,29,.08);      /* 下拉、Popover */
--shadow-3: 0 12px 32px rgba(20,24,29,.12);    /* Modal、抽屉 */
--shadow-focus: 0 0 0 2px #FFFFFF, 0 0 0 4px rgba(210,67,31,.45);

/* 边框 */
--border-width: 1px;
--border-color: var(--gray-200);
--border-color-strong: var(--gray-300);

/* 动效 —— 150ms 收敛值 */
--motion-instant: 80ms;   /* 按下反馈 */
--motion-fast: 150ms;     /* hover、选中、焦点（默认值） */
--motion-base: 200ms;     /* 行插入/删除、抽屉滑入、Toast */
--motion-slow: 260ms;     /* Modal 入场（上限 300ms） */
--ease-standard: cubic-bezier(.2,0,0,1);
--ease-out: cubic-bezier(.16,1,.3,1);

/* 层级 */
--z-base: 0; --z-sticky: 100; --z-dropdown: 1000; --z-sticky-header: 1100;
--z-drawer: 1200; --z-modal: 1300; --z-toast: 1400;
```

**动效规则**：
- 只做能传达含义的动效：行 hover 变色（数据在哪）、行插入高度展开（东西进去了）、总价数字 200ms 滚动（钱变了）。
- 禁止：卡片逐个 fade-in、页面切换动画、按钮弹跳、视差。
- `prefers-reduced-motion: reduce` → 全部时长归 0，数字直接跳变不滚动。

### B.7 数字排版规范（财务级界面的关键细节）

```css
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  text-align: right;
  white-space: nowrap;
  letter-spacing: 0;
}
.num--total { font-size: 22px; font-weight: 590; }
```

| 规则 | 做法 | 原因 |
|---|---|---|
| 对齐 | 金额 / 数量 / 百分比 **一律右对齐**；文本左对齐；状态徽章居中 | 右对齐才能让个位对齐，肉眼可比大小 |
| 千分位 | 统一半角逗号：`12,480.00` | 一半带一半不带 = 不专业 |
| 小数位 | 单价最多 2 位；小计/合计 **强制 2 位**；毛利率 1 位（`12.4%`）；天数/数量为整数 | 同列精度必须一致，否则右对齐也白搭 |
| 货币符号 | **只在列头出现一次**：`成本单价 (¥)`，单元格内不重复 `¥` | 12 列的表里，每个单元格都带 ¥ 会吃掉 8% 横向空间 |
| 负号 | 用 `−`（U+2212），不用 `-`（hyphen） | U+2212 与数字同宽同高，负号列能对齐 |
| 缺失值 | 显示 `—`（em dash），色 `--table-cell-num-muted`，hover 提示原因 | 空单元格会被误读成 0，而 0 是一个真实的价格 |
| 数字防抖 | 实时计算的合计用 200ms 数字滚动（`transition` 于 transform），不做逐位跳动 | 逐位跳动会让眼睛疼 |
| 单位 | 单价旁必须带单位：`¥45.00 /根/天`，单位字号 11px、色 `--gray-600` | 桁架按"根/天"、喷绘按"㎡"、主持按"场"，漏单位会出人命 |
| 字体回退 | 若字体无 `tnum`，浏览器静默回退比例数字 → **必须实测** `font-variant-numeric` 生效 | 中文场景常见坑：Noto Sans SC 的 tnum 支持不完整，数字必须由 Inter 承载（`font-family` 保持 Inter 在前） |

### B.8 图标系统（P0 铁律：无 emoji）

| 项 | 锁定值 |
|---|---|
| 图标库 | **Lucide**（`lucide-react` / `lucide`） |
| 版本 | **v1.64.0**（架构师 2026-11-04 联网核实并锁进 Spec §3.2.1；lucide 于 2026-03-23 发布 v1 大版本，`0.469.0` 已是旧线。下述 48 条映射在 v1 中全部存在、无改名。全项目不得混入第二套图标库，不得手写一次性 SVG） |
| 描边宽度 | `stroke-width: 1.75`（全项目统一，不随尺寸变化） |
| 尺寸 | **16px**（行内 / 表格内 / 按钮内）/ **20px**（侧边栏导航、工具条按钮）/ **24px**（空状态、独立入口、页头） |
| 颜色 | `currentColor`，随上下文（默认 `--gray-600`，激活 `--accent`，危险 `--danger`） |
| 禁止 | emoji 作功能图标；图标+emoji 混用；只有图标没有 tooltip / aria-label 的按钮 |

**功能 → 图标映射（前端照此实现，不得自行替换）**

| 功能 | Lucide 名称 | 尺寸 |
|---|---|---|
| 工作台 | `gauge` | 20 |
| 物料库 | `package` | 20 |
| 人员库 | `users` | 20 |
| 供应商 | `factory` | 20 |
| 攒单 / 报价单 | `file-text` / `inbox` | 20 |
| 专业嘉宾（独立入口） | `graduation-cap` | 20 |
| 供应商类型-线上电商 | `shopping-bag` | 16 |
| 供应商类型-线下定做厂 | `factory` | 16 |
| 供应商类型-租赁商 | `warehouse` | 16 |
| 供应商类型-个人兼职 | `user-round` | 16 |
| 供应商类型-自有人员 | `users` | 16 |
| 不在客户版显示 | `eye-off` | 16 |
| 最低档命中 | `chevron-down` | 16 |
| 设置 | `settings` | 20 |
| 全局搜索 / 命令面板 | `search` / `command` | 16 / 20 |
| 新建 | `plus` | 16 |
| 编辑 / 行内编辑 | `pencil` / `pencil-line` | 16 |
| 删除 | `trash-2` | 16 |
| 复制 / 复制行 | `copy` | 16 |
| 更多操作 | `more-horizontal` | 16 |
| 导出 PDF / Excel | `download` / `file-down` | 16 |
| 打印 | `printer` | 16 |
| 筛选 | `list-filter` | 16 |
| 排序 | `arrow-up-down` | 14→16 |
| 列设置 | `columns-3` | 16 |
| 密度切换 | `rows-3` | 16 |
| 最低价标记 | `trending-down` | 16 |
| 涨价 | `trending-up` | 16 |
| 价格过期 | `clock-alert` | 16 |
| 风险提示 | `triangle-alert` | 16 |
| 单位换算 | `ruler` | 16 |
| 阶梯价 | `layers` | 16 |
| 拖拽排序 | `grip-vertical` | 16 |
| 附件 | `paperclip` | 16 |
| 图片 | `image` | 16 |
| 档期 / 日期 | `calendar-days` | 16 |
| 历史 / 改价记录 | `history` | 16 |
| 毛利 | `percent` | 16 |
| 成本 | `wallet` | 16 |
| 报价 | `receipt` | 16 |
| 权限 / 锁定 | `lock` | 16 |
| 角色 | `shield` | 16 |
| 撤销 / 重做 | `undo-2` / `redo-2` | 16 |
| 折叠面板 | `panel-left` / `chevron-down` | 16 |
| 关闭 | `x` | 16 |
| 成功 | `circle-check` | 16 |
| 信息 | `info` | 16 |
| 错误 | `circle-alert` | 16 |
| 加载 | `loader-circle`（旋转） | 16 |
| 快捷键帮助 | `keyboard` | 16 |

### B.9 完整 Design Token CSS

```css
/* ============================================================
   design-tokens.css — 活动报价管理系统 v1.0
   由 docs/03-UIUX.md 定义，唯一真源见 design-tokens.json
   ============================================================ */

:root,
[data-theme="light"] {
  /* ---------- A1-identity · 灰阶 ---------- */
  --gray-50:#F7F8FA;  --gray-100:#F1F3F5; --gray-200:#E3E6EB;
  --gray-300:#CDD3DB; --gray-400:#A8B0BC; --gray-500:#7A8493;
  --gray-600:#5A6473; --gray-700:#3B4453; --gray-800:#262D38; --gray-900:#14181D;

  --white:#FFFFFF;

  /* ---------- A1-identity · 表面与前景 ---------- */
  --bg: var(--gray-50);
  --surface: var(--white);
  --surface-raised: var(--white);
  --surface-sunken: var(--gray-100);
  --surface-warm: #FAF9F7;          /* B-slot：极少量暖调表面（仅用于"提示/说明"块） */
  --sidebar-bg: var(--ink);
  --sidebar-fg: #E8EBEF;
  --sidebar-fg-muted: #8A93A1;
  --sidebar-item-hover: #22262D;
  --sidebar-item-active: #2C3138;

  --fg: var(--gray-900);
  --fg-2: var(--gray-700);
  --fg-3: var(--gray-600);
  --fg-meta: var(--gray-500);
  --fg-placeholder: var(--gray-400);
  --fg-on-ink: #F2F4F6;

  --border: var(--gray-200);
  --border-soft: #EBEEF1;
  --border-strong: var(--gray-300);

  /* ---------- A1-identity · 品牌 ---------- */
  --ink: #14181D;
  --ink-hover: #272A31;
  --accent: #D2431F;
  --accent-hover: #B8371A;
  --accent-active: #9C2D14;
  --accent-subtle: #FDF1ED;
  --accent-border: #F3C9BC;
  --accent-on: #FFFFFF;

  /* ---------- A2 · 语义 ---------- */
  --success: #15803D;  --success-subtle: #F0FDF4;  --success-border: #BBF7D0;
  /* 危险红：文字族（L*30.29）与朱砂（L*49.27）差 18.98；填充只走 --danger-fill */
  --danger:  #8C1A11;  --danger-hover: #73150D;  --danger-active: #5C110A;
  --danger-fill: #8C1A11;  --danger-on: #FFFFFF;
  --danger-subtle:  #FEF3F2;  --danger-border:  #FECDCA;
  --link-fg: #0E7490;  --link-fg-hover: #0B5F76;   /* 朱砂不做文字色，链接走这里 */
  --warning: #A16207;  --warning-subtle: #FEFCE8;  --warning-border: #FDE68A;
  --info:    #0E7490;  --info-subtle:    #ECFEFF;  --info-border:    #A5F3FC;

  /* 资金语义别名（C-extension，业务语义直读） */
  --money-save: var(--success);
  --money-save-bg: var(--success-subtle);
  --money-loss: var(--danger);
  --money-loss-bg: var(--danger-subtle);
  --price-lowest: var(--success);
  --price-lowest-bg: var(--success-subtle);
  --price-lowest-border: var(--success-border);
  --data-risk: var(--warning);
  --data-risk-bg: var(--warning-subtle);
  --action-now: var(--accent);

  /* ---------- A1-structure · 字体 ---------- */
  --font-sans: "Inter","Noto Sans SC",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  --font-num:  "Inter","Noto Sans SC",sans-serif;
  --font-mono: "JetBrains Mono","SF Mono",Consolas,monospace;

  --text-2xs: 11px; --text-xs: 12px; --text-sm: 13px; --text-base: 14px;
  --text-md: 16px;  --text-lg: 18px; --text-xl: 22px; --text-2xl: 28px;

  --lh-2xs: 14px; --lh-xs: 16px; --lh-sm: 20px; --lh-base: 22px;
  --lh-md: 24px;  --lh-lg: 26px; --lh-xl: 28px; --lh-2xl: 34px;

  --fw-regular: 400; --fw-medium: 510; --fw-semibold: 590; --fw-bold: 700;
  --ls-tight: -0.01em; --ls-tighter: -0.02em; --ls-normal: 0;
  --ls-wide: 0.02em; --ls-wider: 0.08em;

  /* ---------- A2 · 间距 ---------- */
  --space-1: 2px;  --space-2: 4px;  --space-3: 8px;  --space-4: 12px;
  --space-5: 16px; --space-6: 20px; --space-7: 24px; --space-8: 32px;
  --space-9: 40px; --space-10: 48px; --space-11: 64px;

  /* ---------- A2 · 圆角 ---------- */
  --radius-xs: 2px; --radius-sm: 4px; --radius-md: 6px;
  --radius-lg: 8px; --radius-xl: 12px; --radius-full: 9999px;

  /* ---------- A2 · 阴影 ---------- */
  --shadow-1: 0 1px 2px rgba(20,24,29,.06);
  --shadow-2: 0 2px 8px rgba(20,24,29,.08);
  --shadow-3: 0 12px 32px rgba(20,24,29,.12);
  --shadow-focus: 0 0 0 2px #FFFFFF, 0 0 0 4px rgba(210,67,31,.45);

  /* ---------- A2 · 动效 ---------- */
  --motion-instant: 80ms; --motion-fast: 150ms;
  --motion-base: 200ms;   --motion-slow: 260ms;
  --ease-standard: cubic-bezier(.2,0,0,1);
  --ease-out: cubic-bezier(.16,1,.3,1);

  /* ---------- B-slot · 布局 ---------- */
  --sidebar-w: 216px;
  --sidebar-w-collapsed: 56px;
  --topbar-h: 52px;
  --page-pad-x: 24px;
  --container-max: 1600px;
  --editor-drawer-w: 320px;
  --editor-footbar-h: 60px;

  /* ---------- B-slot · 表格 ---------- */
  --table-header-bg: var(--gray-100);
  --table-header-fg: var(--gray-600);
  --table-header-border: var(--gray-200);
  --table-row-border: #EBEEF1;
  --table-row-hover: var(--gray-50);
  --table-row-selected: var(--accent-subtle);
  --table-row-selected-border: var(--accent-border);
  --table-zebra: #FBFBFC;
  --table-sticky-col-bg: var(--white);
  --table-sticky-col-shadow: inset -8px 0 8px -8px rgba(20,24,29,.10);
  --table-sticky-header-shadow: 0 4px 8px -4px rgba(20,24,29,.10);
  --table-cell-pad-x: 12px;
  --table-row-h: 36px;
  --table-header-h: 36px;
  --table-num-fg: var(--gray-900);
  --table-num-muted: var(--gray-400);

  /* ---------- C-extension · 图表配色（克制，不用彩虹） ---------- */
  --chart-1: #14181D;  /* 主序列 / 最低价 */
  --chart-2: #D2431F;  /* 第二序列 */
  --chart-3: #0E7490;
  --chart-4: #A16207;
  --chart-5: #7A8493;
  --chart-grid: #EBEEF1;
  --chart-axis-fg: #7A8493;
  --chart-reference: #CDD3DB;   /* 参考线：当前基准价 */
}

/* 密度切换：<html data-density="compact|standard|comfortable"> */
[data-density="compact"]     { --table-row-h: 32px; --table-header-h: 32px; --text-sm: 12px; --lh-sm: 18px; }
[data-density="standard"]    { --table-row-h: 36px; --table-header-h: 36px; }
[data-density="comfortable"] { --table-row-h: 44px; --table-header-h: 40px; --text-sm: 14px; --lh-sm: 22px; }

/* ---------- 深色皮肤（可选，非默认） ---------- */
[data-theme="dark"] {
  --gray-50:#0F1216;  --gray-100:#161A20; --gray-200:#232932;
  --gray-300:#2F3641; --gray-400:#5A6473; --gray-500:#7A8493;
  --gray-600:#9AA3AF; --gray-700:#B8BFC9; --gray-800:#D6DBE1; --gray-900:#EDEFF2;
  --white:#161A20;

  --bg:#0F1216;
  --surface:#161A20;
  --surface-raised:#1D2229;
  --surface-sunken:#11151A;
  --surface-warm:#1A1E24;
  --sidebar-bg:#0B0D10;
  --sidebar-fg:#D6DBE1;
  --sidebar-fg-muted:#6F7884;
  --sidebar-item-hover:#1A1E24;
  --sidebar-item-active:#232932;

  --fg:#EDEFF2; --fg-2:#D6DBE1; --fg-3:#9AA3AF; --fg-meta:#7A8493;
  --fg-placeholder:#5A6473; --fg-on-ink:#EDEFF2;
  --border:#232932; --border-soft:#1D2229; --border-strong:#2F3641;

  --ink:#EDEFF2; --ink-hover:#FFFFFF;
  --accent:#F0603C;         /* 深色下朱砂提亮，保证 4.5:1 */
  --accent-hover:#F47A5B;
  --accent-active:#D2431F;
  --accent-subtle:#2A1A15;
  --accent-border:#5A2A1B;
  --accent-on:#14181D;

  --success:#4ADE80; --success-subtle:#0E2018; --success-border:#14532D;
  /* 深色皮肤：明度关系反转，危险色更亮（L* 80.09 vs 朱砂 59.17 = 20.92） */
  --danger:#FFB4AB;  --danger-hover:#FFC7C2;  --danger-active:#FFD3CF;
  --danger-fill:#B4241A;  --danger-fill-hover:#9A1D13;  --danger-on:#FFFFFF;
  --danger-subtle:#251113;  --danger-border:#7F1D1D;
  --link-fg:#38BDF8;
  --warning:#FBBF24; --warning-subtle:#241C08; --warning-border:#78350F;
  --info:#38BDF8;    --info-subtle:#0A1E24;    --info-border:#0E4A5C;

  --table-header-bg:#1A1E24;
  --table-row-border:#1D2229;
  --table-row-hover:#1A1E24;
  --table-sticky-col-bg:#161A20;
  --table-zebra:#191D23;

  --chart-1:#EDEFF2; --chart-2:#F0603C; --chart-3:#38BDF8;
  --chart-4:#FBBF24; --chart-5:#7A8493; --chart-grid:#232932; --chart-axis-fg:#7A8493;

  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 2px 8px rgba(0,0,0,.5);
  --shadow-3: 0 12px 32px rgba(0,0,0,.6);
  --shadow-focus: 0 0 0 2px #161A20, 0 0 0 4px rgba(240,96,60,.5);
}

/* ---------- 无障碍基线 ---------- */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .num--animated { transition: color var(--motion-base) var(--ease-standard); }
}
```

### B.10 Design Token JSON（前端 import 用）

```json
{
  "$schema": "https://design-tokens.org/draft",
  "color": {
    "gray": {
      "50":  { "value": "#F7F8FA", "type": "color" },
      "100": { "value": "#F1F3F5", "type": "color" },
      "200": { "value": "#E3E6EB", "type": "color" },
      "300": { "value": "#CDD3DB", "type": "color" },
      "400": { "value": "#A8B0BC", "type": "color" },
      "500": { "value": "#7A8493", "type": "color" },
      "600": { "value": "#5A6473", "type": "color" },
      "700": { "value": "#3B4453", "type": "color" },
      "800": { "value": "#262D38", "type": "color" },
      "900": { "value": "#14181D", "type": "color" }
    },
    "surface": {
      "bg":      { "value": "#F7F8FA", "type": "color" },
      "default": { "value": "#FFFFFF", "type": "color" },
      "sunken":  { "value": "#F1F3F5", "type": "color" },
      "warm":    { "value": "#FAF9F7", "type": "color" },
      "sidebar": { "value": "#14181D", "type": "color" }
    },
    "fg": {
      "default":     { "value": "#14181D", "type": "color" },
      "secondary":   { "value": "#3B4453", "type": "color" },
      "tertiary":    { "value": "#5A6473", "type": "color" },
      "meta":        { "value": "#7A8493", "type": "color" },
      "placeholder": { "value": "#A8B0BC", "type": "color" },
      "onInk":       { "value": "#F2F4F6", "type": "color" },
      "onAccent":    { "value": "#FFFFFF", "type": "color" }
    },
    "border": {
      "default": { "value": "#E3E6EB", "type": "color" },
      "soft":    { "value": "#EBEEF1", "type": "color" },
      "strong":  { "value": "#CDD3DB", "type": "color" }
    },
    "brand": {
      "ink":        { "value": "#14181D", "type": "color" },
      "inkHover":   { "value": "#272A31", "type": "color" },
      "accent":     { "value": "#D2431F", "type": "color" },
      "accentHover":{ "value": "#B8371A", "type": "color" },
      "accentActive":{ "value": "#9C2D14", "type": "color" },
      "accentSubtle":{ "value": "#FDF1ED", "type": "color" },
      "accentBorder":{ "value": "#F3C9BC", "type": "color" }
    },
    "semantic": {
      "success": { "value": "#15803D", "type": "color" },
      "successSubtle": { "value": "#F0FDF4", "type": "color" },
      "successBorder": { "value": "#BBF7D0", "type": "color" },
      "danger":  { "value": "#8C1A11", "type": "color" },   /* 仅文字族 */
      "dangerFill": { "value": "#8C1A11", "type": "color" }, /* 仅填充族 */
      "linkFg":  { "value": "#0E7490", "type": "color" },
      "dangerSubtle": { "value": "#FEF3F2", "type": "color" },
      "dangerBorder": { "value": "#FECDCA", "type": "color" },
      "warning": { "value": "#A16207", "type": "color" },
      "warningSubtle": { "value": "#FEFCE8", "type": "color" },
      "warningBorder": { "value": "#FDE68A", "type": "color" },
      "info":    { "value": "#0E7490", "type": "color" },
      "infoSubtle": { "value": "#ECFEFF", "type": "color" }
    },
    "money": {
      "save":        { "value": "#15803D", "type": "color" },
      "saveBg":      { "value": "#F0FDF4", "type": "color" },
      "loss":        { "value": "#8C1A11", "type": "color" },
      "lossBg":      { "value": "#FEF3F2", "type": "color" },
      "lowest":      { "value": "#15803D", "type": "color" },
      "lowestBg":    { "value": "#F0FDF4", "type": "color" },
      "lowestBorder":{ "value": "#BBF7D0", "type": "color" },
      "risk":        { "value": "#A16207", "type": "color" },
      "riskBg":      { "value": "#FEFCE8", "type": "color" }
    }
  },
  "font": {
    "family": {
      "sans": { "value": "Inter, \"Noto Sans SC\", -apple-system, \"PingFang SC\", \"Microsoft YaHei\", sans-serif", "type": "fontFamily" },
      "num":  { "value": "Inter, \"Noto Sans SC\", sans-serif", "type": "fontFamily" },
      "mono": { "value": "\"JetBrains Mono\", \"SF Mono\", Consolas, monospace", "type": "fontFamily" }
    },
    "size": {
      "2xs": { "value": "11px", "type": "dimension" },
      "xs":  { "value": "12px", "type": "dimension" },
      "sm":  { "value": "13px", "type": "dimension" },
      "base":{ "value": "14px", "type": "dimension" },
      "md":  { "value": "16px", "type": "dimension" },
      "lg":  { "value": "18px", "type": "dimension" },
      "xl":  { "value": "22px", "type": "dimension" },
      "2xl": { "value": "28px", "type": "dimension" }
    },
    "lineHeight": {
      "2xs": "14px", "xs": "16px", "sm": "20px", "base": "22px",
      "md": "24px", "lg": "26px", "xl": "28px", "2xl": "34px"
    },
    "weight": {
      "regular":  { "value": 400, "type": "fontWeight" },
      "medium":   { "value": 510, "type": "fontWeight" },
      "semibold": { "value": 590, "type": "fontWeight" },
      "bold":     { "value": 700, "type": "fontWeight" }
    },
    "tracking": {
      "tight": "-0.01em", "tighter": "-0.02em", "normal": "0",
      "wide": "0.02em", "wider": "0.08em"
    }
  },
  "space": {
    "1": { "value": "2px", "type": "dimension" },
    "2": { "value": "4px", "type": "dimension" },
    "3": { "value": "8px", "type": "dimension" },
    "4": { "value": "12px", "type": "dimension" },
    "5": { "value": "16px", "type": "dimension" },
    "6": { "value": "20px", "type": "dimension" },
    "7": { "value": "24px", "type": "dimension" },
    "8": { "value": "32px", "type": "dimension" },
    "9": { "value": "40px", "type": "dimension" },
    "10":{ "value": "48px", "type": "dimension" },
    "11":{ "value": "64px", "type": "dimension" }
  },
  "radius": {
    "xs":   { "value": "2px", "type": "dimension" },
    "sm":   { "value": "4px", "type": "dimension" },
    "md":   { "value": "6px", "type": "dimension" },
    "lg":   { "value": "8px", "type": "dimension" },
    "xl":   { "value": "12px", "type": "dimension" },
    "full": { "value": "9999px", "type": "dimension" }
  },
  "shadow": {
    "1":     { "value": "0 1px 2px rgba(20,24,29,.06)", "type": "boxShadow" },
    "2":     { "value": "0 2px 8px rgba(20,24,29,.08)", "type": "boxShadow" },
    "3":     { "value": "0 12px 32px rgba(20,24,29,.12)", "type": "boxShadow" },
    "focus": { "value": "0 0 0 2px #FFFFFF, 0 0 0 4px rgba(210,67,31,.45)", "type": "boxShadow" }
  },
  "motion": {
    "instant": { "value": "80ms", "type": "duration" },
    "fast":    { "value": "150ms", "type": "duration" },
    "base":    { "value": "200ms", "type": "duration" },
    "slow":    { "value": "260ms", "type": "duration" },
    "easeStandard": { "value": "cubic-bezier(.2,0,0,1)", "type": "cubicBezier" },
    "easeOut":      { "value": "cubic-bezier(.16,1,.3,1)", "type": "cubicBezier" }
  },
  "layout": {
    "sidebarWidth":       { "value": "216px", "type": "dimension" },
    "sidebarCollapsed":   { "value": "56px", "type": "dimension" },
    "topbarHeight":       { "value": "52px", "type": "dimension" },
    "pagePadX":           { "value": "24px", "type": "dimension" },
    "containerMax":       { "value": "1600px", "type": "dimension" },
    "editorDrawerWidth":  { "value": "320px", "type": "dimension" },
    "editorFootbarHeight":{ "value": "60px", "type": "dimension" }
  },
  "table": {
    "headerBg":     { "value": "#F1F3F5", "type": "color" },
    "headerFg":     { "value": "#5A6473", "type": "color" },
    "headerHeight": { "value": "36px", "type": "dimension" },
    "rowHeight":    { "value": "36px", "type": "dimension" },
    "rowHeightCompact": { "value": "32px", "type": "dimension" },
    "rowHeightComfortable": { "value": "44px", "type": "dimension" },
    "rowBorder":    { "value": "#EBEEF1", "type": "color" },
    "rowHover":     { "value": "#F7F8FA", "type": "color" },
    "rowSelected":  { "value": "#FDF1ED", "type": "color" },
    "cellPadX":     { "value": "12px", "type": "dimension" },
    "stickyColBg":  { "value": "#FFFFFF", "type": "color" },
    "stickyColShadow": { "value": "inset -8px 0 8px -8px rgba(20,24,29,.10)", "type": "boxShadow" }
  },
  "icon": {
    "library": { "value": "lucide", "type": "string" },
    "version": { "value": "1.64.0", "type": "string" },
    "strokeWidth": { "value": 1.75, "type": "number" }
  }
}
```

### B.11 Tailwind 配置片段

```js
// tailwind.config.js —— 与本文件 B.9 / B.10 严格对应，不新增裸值
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        gray: { 50:'#F7F8FA',100:'#F1F3F5',200:'#E3E6EB',300:'#CDD3DB',
                400:'#A8B0BC',500:'#7A8493',600:'#5A6473',700:'#3B4453',
                800:'#262D38',900:'#14181D' },
        ink:    { DEFAULT:'#14181D', hover:'#272A31' },
        accent: { DEFAULT:'#D2431F', hover:'#B8371A', active:'#9C2D14',
                  subtle:'#FDF1ED', border:'#F3C9BC', on:'#FFFFFF' },
        success:{ DEFAULT:'#15803D', subtle:'#F0FDF4', border:'#BBF7D0' },
        danger: { DEFAULT:'#8C1A11', fill:'#8C1A11', on:'#FFFFFF', subtle:'#FEF3F2', border:'#FECDCA' },
        link:   { DEFAULT:'#0E7490', hover:'#0B5F76' },
        warning:{ DEFAULT:'#A16207', subtle:'#FEFCE8', border:'#FDE68A' },
        info:   { DEFAULT:'#0E7490', subtle:'#ECFEFF', border:'#A5F3FC' },
        surface:{ DEFAULT:'#FFFFFF', sunken:'#F1F3F5', warm:'#FAF9F7', sidebar:'#14181D' },
        fg:     { DEFAULT:'#14181D', 2:'#3B4453', 3:'#5A6473', meta:'#7A8493',
                  placeholder:'#A8B0BC', onInk:'#F2F4F6' },
        border: { DEFAULT:'#E3E6EB', soft:'#EBEEF1', strong:'#CDD3DB' }
      },
      fontFamily: {
        sans: ['Inter','Noto Sans SC','-apple-system','PingFang SC','Microsoft YaHei','sans-serif'],
        num:  ['Inter','Noto Sans SC','sans-serif'],
        mono: ['JetBrains Mono','SF Mono','Consolas','monospace']
      },
      fontSize: {
        '2xs':['11px',{lineHeight:'14px'}], xs:['12px',{lineHeight:'16px'}],
        sm:['13px',{lineHeight:'20px'}],    base:['14px',{lineHeight:'22px'}],
        md:['16px',{lineHeight:'24px'}],    lg:['18px',{lineHeight:'26px'}],
        xl:['22px',{lineHeight:'28px'}],    '2xl':['28px',{lineHeight:'34px'}]
      },
      fontWeight: { normal:'400', medium:'510', semibold:'590', bold:'700' },
      spacing: { 0.5:'2px',1:'4px',2:'8px',3:'12px',4:'16px',5:'20px',
                 6:'24px',8:'32px',10:'40px',12:'48px',16:'64px' },
      borderRadius: { xs:'2px', sm:'4px', md:'6px', lg:'8px', xl:'12px' },
      boxShadow: {
        '1':'0 1px 2px rgba(20,24,29,.06)',
        '2':'0 2px 8px rgba(20,24,29,.08)',
        '3':'0 12px 32px rgba(20,24,29,.12)',
        focus:'0 0 0 2px #FFFFFF, 0 0 0 4px rgba(210,67,31,.45)'
      },
      transitionDuration: { instant:'80ms', fast:'150ms', base:'200ms', slow:'260ms' },
      transitionTimingFunction: {
        standard:'cubic-bezier(.2,0,0,1)', out:'cubic-bezier(.16,1,.3,1)'
      },
      maxWidth: { container:'1600px' }
    }
  }
}
```

---

## C. 页面清单与布局方案

### 全局外壳（所有内页共用）

```
┌────────────┬──────────────────────────────────────────────────────────────────────────┐
│ 216px      │  顶栏 52px                                                                │
│            │  面包屑 / 页面标题            ⌘K 全局搜索        [密度] [帮助]  王磊 v     │
│  ◆ 有底   ├──────────────────────────────────────────────────────────────────────────┤
│            │                                                                            │
│  工作台     │   内容区  padding 24px（≥1440 时 32px）  max-width 1600px 居中            │
│  物料库     │                                                                            │
│  人员库     │                                                                            │
│  供应商     │                                                                            │
│  攒单       │                                                                            │
│  ─────      │                                                                            │
│  设置       │                                                                            │
│            │                                                                            │
│  [«] 折叠   │                                                                            │
└────────────┴──────────────────────────────────────────────────────────────────────────┘
```

- 侧边栏：底色 `--ink` `#14181D`，导航项 32px 高、图标 20px + 文字 14px、间距 2px。当前项：底 `var(--sidebar-item-active)` `#2C3138` + 左侧 2px 朱砂竖条 + 文字 `#FFFFFF`。（这里左侧竖条是**导航选中指示器**，不是卡片装饰条，属于语义必需。）
- 折叠态 56px：仅图标 + hover tooltip；`⌘/Ctrl+B` 切换，状态存 localStorage。
- 顶栏：纯白 + 1px 下边框，不吸顶阴影（滚动时才加 `--table-sticky-header-shadow`）。
- 全局搜索：点击或 `⌘K` 打开命令面板（居中 560px 宽，`--shadow-3`），支持"搜物料 / 搜人员 / 搜供应商 / 跳页 / 执行动作"，输入即搜，↑↓ 选，↵ 打开。

---

### C.1 登录页 `/login`

**目标**：3 秒内进系统。不做品牌营销，不放插画。

```
┌──────────────────────────────────────────────┬───────────────────────────────────────┐
│                                              │                                       │
│                                              │   ┌───────────────────────────────┐   │
│   有底                                      │   │ 登录                          │   │
│   物料 · 人员 · 供应商 · 报价                   │   │                               │   │
│                                              │   │ 账号                           │   │
│   ── 最近一次登录 ──                          │   │ [ wanglei@huodong.cn        ] │   │
│                                              │   │                               │   │
│   09-28  年会《向新而行》  报价单 BJ-2614      │   │ 密码                          │   │
│   09-24  发布会《新机有戏》 报价单 BJ-2608     │   │ [ ••••••••••            (o) ]  │   │
│   09-18  客户答谢宴         报价单 BJ-2597     │   │                               │   │
│                                              │   │ [        登 录              ] │   │
│                                              │   │                               │   │
│   （登录后自动回到你上次停留的位置）            │   │ 忘记密码找管理员重置            │   │
│                                              │   └───────────────────────────────┘   │
│  底色: --ink (#14181D)   文字: #E8EBEF        │   底色: --surface (#FFFFFF)           │
└──────────────────────────────────────────────┴───────────────────────────────────────┘
        左侧 56%  展示真实业务痕迹                右侧 44%  表单，垂直居中
```

- **左侧不是营销区**，是"上次你在哪"的记忆区：列 3 条最近打开的报价单（真实单号 + 活动名 + 时间）。这让"报价员点进来就想干活"的需求被满足，而不是看一个 Hero。
- 表单宽度 `min(360px, 100%)`（窄屏让位于视口，否则右端的眼睛图标会被裁掉），输入框高 40px，`autocomplete="username"` / `current-password`。
- **密码可见性用框内右侧的眼睛图标**（28×28 点击区，距右边框 4px，框内留 40px 内边距让文字不钻到图标下面）。
  - 睁眼 = 点它会露出来；闭眼 = 点它会藏回去。**图标说的是"点了会发生什么"，不是"现在是什么状态"**——与明细表里显示/隐藏那一列的眼睛同一条约定，两处搞反是这类控件最常见的错。
  - `aria-label` 随状态在 `显示密码` / `隐藏密码` 之间切换，`title` 同文案；Tab 从输入框落到图标，Enter / 空格切换，`type="button"` 保证不提交表单。
  - 焦点环画在图标内侧（`inset`），不外扩——它本来就贴在输入框里，外扩的环会压到输入框边框上，看起来像两个框叠在一起。

- 错误态：字段下方红字 + `circle-alert` 16px：`账号或密码不对。连续 5 次会锁定 15 分钟。`
- 视觉细节：左侧底部有一行 11px 灰字版本号 `v1.0.0`（内部工具的诚实感）。
- 不做：第三方登录、注册入口、插画、装饰渐变。

---

### C.2 工作台 `/`（首页）

**目标**：回答"我今天该动哪三件事"，**不是数据大屏**。零图表，零 KPI 卡片。

```
┌ 工作台 ──────────────────────────────────────────────────────────── [+ 新建报价单] ┐
│                                                                                    │
│  上午好，王磊。今天有 4 件事要处理。                    （按 ⌘K 随时搜物料）          │
│                                                                                    │
│ ── 待处理 ────────────────────────────────────────────────────────────────────────  │
│                                                                                    │
│  ① 2 张报价单还是草稿，客户在等                                             [去看] │
│     年会《向新而行》 BJ-2614 · 最后编辑 昨天 18:42 · 合计 ¥128,460                 │
│     新品发布会《新机有戏》 BJ-2615 · 最后编辑 今天 09:12 · 合计 ¥96,200            │
│                                                                                    │
│  ② 3 个价已经失效了，拿它们出单会被拦住（红）                                [去处理] │
│     宴会圆桌 1.8m 桌套 · 金桥桁架厂 · 2025-03-11 到期 · ¥85.00/套                   │
│     LED 屏 P3.91 · 淘宝-演艺设备 · 2026-06-30 到期 · ¥420.00/㎡/天                  │
│     冷焰火机 · 星光灯光 · 2026-05-02 到期 · ¥180.00/台                              │
│                                                                                    │
│  ③ 6 个物料 90 天没核价了，还能用，但报价前扫一眼（琥珀）                     [去核] │
│     喷绘布 550 高精 · 淘宝-喷绘之家 · 187 天 · ¥28.00/㎡                            │
│     桁架 3m 方管 · 金桥桁架厂 · 121 天 · ¥45.00/根/天                              │
│     帕灯 54 颗 3W · 星光灯光 · 96 天 · ¥18.00/台/天                                │
│     ⋯ 还有 3 个                                                                     │
│                                                                                    │
│  ④ 4 个常用物料还没有任何供应商报价，比价时会是空的                          [去补] │
│     冷焰火机 · 迎宾拱门 8m · 签到 KT 板 2.4×1.2m · 兼职搭建工                       │
│                                                                                    │
│ ── 最近动作（仅管理员可见 · 只记录不阻断）─ [全部人 v] [全部类型 v] [全部 →]           │
│                                                                                    │
│  时间        类型  物料                供应商         原价      现价      变化   谁    │
│  今天 09:24  改价  桁架 3m 方管        金桥桁架厂     ¥48.00    ¥45.00   -6.3%  王磊 │
│  今天 09:12  录价  喷绘布 550 高精      淘宝-喷绘之家  —         ¥28.00   —      陈默 │
│  昨天 17:40  手填  兼职礼仪（1.7m+）    星辉经纪      —         ¥680.00  —      李思雨│
│  昨天 11:38  改价  喷绘布 550 高精      淘宝-喷绘之家  ¥26.00    ¥28.00   +7.7%  陈默 │
│  09-26 15:20 录价  兼职礼仪（1.7m+）    星辉经纪      —         ¥650.00  —      王磊 │
│                                                                                    │
│ ── 常用物料 ─────────────────────────────────────────────── [编辑常用 →] ──────────  │
│  [桁架 3m 方管 ¥45/根天] [喷绘布 550 ¥28/㎡] [LED P3.91 租¥380/天 2种性质] [帕灯 ¥18] │
│  [张启明 ¥2,800/场]  [兼职礼仪 ¥650/天]  [宴会圆桌+椅套 ¥85/套]                     │
│  （点击直接加入新报价单；⌘/Ctrl+点击 打开比价）                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**布局决策**：
- 四块"待处理"用**编号 + 一句话 + 数字 + 右侧动作**的行式布局，不用卡片网格。每块最多露 3 条，超出折叠为 `⋯ 还有 5 个`。**第 ② 块和第 ③ 块必须分开，这不是排版偏好，是语义要求**：一个是"用它会出事"（红），一个是"它能用但老了"（琥珀）。混成一块「价格有问题」，用户就分不出哪件事今天必须做。
- **待处理的时间口径（v1.2 统一）**：一律用 `max(updated_at, last_used_at)` 计算陈旧天数，**不是单纯的 `updated_at`**。一个价 187 天没改、但上周刚出过单、客户也没投诉，说明它大概率还有效——这时候催人是纯噪音。**用户一旦对提醒脱敏，所有提醒都会被忽略，包括真正重要的那些。**
- 第 ② 块（已失效）的排序按**到期日倒序**（最近刚失效的排最上，因为最可能被误用）；第 ③ 块（陈旧）按陈旧天数倒序。
- **「最近动作」是 R15 的伴生清单，三个选项都要它，所以先做**：把 `录价 / 改价 / 手填` 三种动作放在一张表里，可按人筛。
  - **只记录、不阻断、不排行、不做"最活跃排行"**。一旦变成排行榜，人就会为了排名乱录，比不记录更糟。它的用途只有一个：出问题时能问对人。
  - 第三种动作 **`手填`** 必须进来。因为手填是"没有记录、无法追溯、无法纠正"的操作（见 §E.7），**它比录错价更需要被看见**。
  - **仅管理员可见**：member 看不到这一块，避免变成互相监视。这是"可见性用来追责、不用来管理"的边界。
- 这张表是真正的表格（5 行），金额列右对齐、变化列用颜色 + 符号（涨红跌绿？**不**——涨价对成本是坏事，跌价是好事。所以：涨 = `--danger` + `trending-up`，跌 = `--success` + `trending-down`。这里颜色含义仍是"钱上吃不吃亏"，与全系统一致）。
- "常用物料"是 chip 流，点一下即进新报价单（这是报价员使用频率最高的动作，必须 1 次点击）。
- 空数据新用户：整页退化为一个引导块——`系统还是空的。先建 5 个你天天要报价的物料，比价和出单才能跑起来。[从 Excel 导入物料] [手动新建]`
- **明确不做**：本月签单额大数字、环形图、柱状趋势、"数据大屏"黑底。

**`GET /dashboard/summary` 的字段 ↔ 本页哪一块（架构 ④，v1.6 对齐，一个字段都不许多渲染）**

| 字段 | 落在哪 | 界面表现 |
|---|---|---|
| `unread_notification_count` | 顶栏铃铛 | 角标数字，`>9` 显示 `9+`；**不进"待处理"四块**（通知不是任务，混进任务区会让四块变成五块，编号就失效） |
| `has_overdue_price` + 计数 | 第 ② 块（红） | `3 个价已经失效了，拿它们出单会被拦住` |
| `stale_price_count` | 第 ③ 块（琥珀） | `6 个物料 90 天没核价了` |
| `recent_price_changes[]`（含 `is_overwrite`） | 「最近动作」表 | 见下 |
| `manual_cost_line_ratio` | **本页不展示** | 见下 |

**`recent_price_changes[].is_overwrite` 的界面处理**

- `is_overwrite = false`（新录一条价）→ `变化` 列显示 `—`，不参与涨跌着色。
- `is_overwrite = true`（**覆盖了已有价**）→ `变化` 列显示涨跌幅，且类型列写 `改价 · 覆盖`，hover `这条覆盖了 09-24 王磊录的 ¥48.00`。
- 理由：**「新增一条价」和「把别人录的价改掉」是两种责任级别完全不同的动作**，混成同一个 `改价` 会让这张表失去它唯一的用途（出问题时能问对人）。

**`manual_cost_line_ratio` 为什么后端给你、但首页不给位置**

- 它是**月度复盘的指标**，不是"今天该动哪件事"。首页四块的准入标准是**每一块都能指向一个具体动作**（去看 / 去处理 / 去核 / 去补）；手填率指向不了任何单条记录，它只能指向"下个月该做点什么"。
- 一个不能指向动作的数字放在"待处理"里，结果是**用户学会忽略这一块**，然后连 ①②③ 一起忽略。这条和「软陈旧计时起点」是同一个道理。
- 它出现在两处：设置页「用量与质量」一行、以及导出给管理员的月度 CSV。首页不出现。

---

### C.3 物料库列表 `/materials`

**目标**：让报价员在 3 秒内找到物料并看到"最便宜多少钱、谁报的、准不准"。

```
┌ 物料库 ────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│ [ 搜物料名称 / 规格 / 别名              /]   [分类 v] [供应商 v] [只看有比价]│
│                                                          [列设置] [密度] [+ 新建]│
│                                                                                    │
│ 分类：全部(248) · 舞美硬体(41) · 灯光音响AV(56) · 印刷物料(38) · 桌椅布草(24)        │
│       美陈软装(29) · 礼品物料(31) · 餐饮服务(18) · 场地设备(11)      ← 物料 8 类，可增删改名 │
│                                                                                    │
│ ┌─┬────────────────────────────┬──────────┬────┬────────┬──────────┬────────────┬──┐│
│ ┌───┬───────────────────────┬─────────┬─────┬─────────┬──────────┬────────────┬──┐ │
│ │[ ]│物料                   │规格     │单位 │最低价   │供应商    │报价数/更新 │  │ │
│ ├───┼───────────────────────┼─────────┼─────┼─────────┼──────────┼────────────┼──┤ │
│ │[ ]│桁架 3m 方管           │3000×3000│根/天│¥45.00   │金桥桁架厂│ 4 家 08-12 │⋯ │ │
│ │[ ]│喷绘布 550 高精        │按㎡     │㎡   │¥28.00   │淘宝-喷绘 │ 3 家 05-02 │⋯ │ │
│ │   │                       │         │     │         │          │ (!) 187天  │  │ │
│ │[ ]│LED 屏 P3.91 室内租赁  │500×500箱│㎡/天│租 ¥380  │星光灯光  │ 5 家 09-28 │⋯ │ │
│ │   │                       │         │     │买 ¥8,000│          │            │  │ │
│ │[ ]│帕灯 54 颗 3W          │RGBW     │台/天│¥18.00   │星光灯光  │ 2 家 06-30 │⋯ │ │
│ │   │                       │         │     │         │          │ (!) 96天   │  │ │
│ │[ ]│宴会圆桌 1.8m 含椅套   │10 椅套  │套/天│—        │—         │ 0 家 —     │⋯ │ │
│ │   │                       │         │     │未报价   │          │            │  │ │
│ │[ ]│外聘主持人             │4 小时   │场   │¥2,800   │星辉经纪  │ 3 家 09-26 │⋯ │ │
│ └───┴───────────────────────┴─────────┴─────┴─────────┴──────────┴────────────┴──┘ │
│                                                                                    │
│ 已选 2 项    [攒进报价单]  [导出 Excel]                    共 248 条  < 1 2 3 … 13 >  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**布局决策（关键）**：列表页**不做供应商列爆炸**。供应商只以"最低价 + 谁报的 + 报价家数"三列呈现，一屏 20 行无横向滚动。要看全比价，点进比价页（卡片式，含数量档切换）。

| 元素 | 规格 |
|---|---|
| 行高 | 36px（标准档），双行内容用 52px 自适应行 |
| 首列 | 冻结（物料名 + 规格两行：名称 13px `--fg`，规格 11px `--fg-3`） |
| 最低价列 | 右对齐、`--fw-medium`、`--success`；并列最低时显示 `¥45.00 ×2` |
| 最低价列 · 数据源 | 渲染 `lowest_summary`（**多行结构**），**不再有 `lowest_price` 标量字段**——架构已删。前端**禁止取 `groups[0]` 冒充最低价**，那是本页最容易造成错单的一处 |
| 最低价列 · `is_multi_group = false` | 单行：`¥45.00`（并列时 `¥45.00 ×2`），右对齐、`--fw-medium`、`--success` |
| 最低价列 · `is_multi_group = true` | **必须逐组渲染多行**，每行 `性质简称 金额/单位`，行高 15px / 11.5px 字：`租 ¥380/天` + `买 ¥8,000/块`。组数 >2 时最多显 2 行 + 第三行 `还有 1 种`。**不允许合并成一个数字、不允许只取第一组、不允许把两种性质相加**。理由：列表页是全局扫视的地方，「最低 ¥380」后面跟着一个卖 ¥8,000 的买断价，就是本页最容易造成错单的一格 |
| 最低价列 · 人员行 | 同一套多行逻辑，维度换 **`unit_mode`（这一条价自己的计价方式）**：`按场 ¥2,800` / `按天 ¥1,500`；组数 = 该人在库里实际有几种 `unit_mode` 的价。**不读 `items.pricing_mode`**——那是档案默认值，不是这一条价的事实（§C.4 反例） |
| **这条规则的适用范围（PRD v1.4 §6.6.1，共 5 处，一处都不能漏）** | ① 物料库列表 ② **人员库列表** ③ **搜索结果**（跨物料与人员） ④ **报价单左侧选品抽屉** ⑤ **工作台「常用物料」chips**（`租 ¥380/天`，不是 `¥380`）。<br>PM 的判断比我狠：**列表页比比价页更危险**——比价页至少有 Tab 提示，列表页没有上下文，用户看到 380 就按 380 记住，而且会记一个星期 |
| 多行渲染的行高处理 | 单组行 36px；多组行用到 2 行时该行升到 **52px**，表格允许行高不齐——**不用"合并成一个数"来换整齐**。`虚拟滚动` 按实际行高计算（TanStack 8.21.3 `estimateSize` 按 `is_multi_group` 分支估） |
| 变化列 | 与 90 天前基准比：`↑7.7%` `--danger` / `↓12%` `--success`，字号 11px |
| 报价数/更新 | `4 家` + `08-12`；超 90 天在下方加 `(!) 187天` 琥珀 11px 徽章 |
| 未报价行 | 最低价列显示 `—` + `未报价` 11px 灰字；整行文字降为 `--fg-meta` |
| 行操作 | hover 时行尾出现 `攒进报价单` `pencil` `more-horizontal`（16px，`--gray-600`）；点行进入比价页 |

**顶部筛选**：搜索框（`/` 聚焦）+ 分类 Tab（带计数）+ 2 个下拉筛选 + "只看有比价" 开关。筛选条件同步进 URL query，可分享/收藏。
**批量**：勾选后底部浮出操作条（不是顶部——顶部有筛选，会打架），显示 `已选 2 项` + 动作。
**分页**：默认 20 条/页，可切 50/100；分页器右下，`共 248 条`。

#### 物料备注（v1.14 新增）

物料档案加一个 `note`（选填，≤1000 字）。它要解决的是"这句话每张单都得跟客户解释一遍"：桁架报价含不含运输、音响含不含调音师、喷绘含不含设计——以前这些只存在报价员脑子里，换个人接单就得再打电话问一遍供应商。

- **一个字段，两个库共用**。物料库与人员库是同一张 `items` 表（靠 `kind` 分），所以"物料备注"和"人员备注"是同一列。只有文案随 `kind` 变（`物料备注` / `人员备注`），行为一模一样——不为两边各写一套代码，也就不会出现"物料备注能搜、人员备注搜不到"这种半边坏掉的情况。
- **它是初值，不是真相**。录进报价单时会带到那一行（见 C.7「行备注」），在单子里改只影响那张单，不回写档案。hint 必须写清这一点，否则用户会以为改单等于改档案，下次开新单发现"没改"。
- **列表页不加备注列**。备注是长句，塞进 36px 行高只有两种结局：被截成六个字（等于没显示），或者把行撑成 52px、一屏少看 5 条。要看备注去编辑抽屉，或比价页（`备注：…` 单独一行，11.5px `--fg-2`，不跟在一堆值后面挤）。
- **搜索命中备注**（`ILIKE` + `trgm` 索引）。报价员记得住的常常是那句话而不是名字——搜"不含电费"能搜出那套音响，比搜"线阵音响"更接近他的思考方式。

---

### C.4 比价页（单个主体 × 多供应商）`/materials/:id` **【出稿优先级 1 · 唯一的差异化视觉锤】**

> **v1.2 重大结构变更（PRD §6.6.1）**：同一物料存在 **买断价 / 租赁价·按天 / 定制加工价** 三种交易性质完全不同的价格。把它们放在一列标"最低 ¥500"是**会产生真实亏损的**——LED 屏买断 ¥8,000、租赁 ¥500/天，报价员照着 `最低 ¥500` 报一个需要买断的活动，一单亏几千。
> **规则：按 `pricing_nature` 分段展示，只在同一性质内标最低、只在同一性质内排序，绝不跨性质比较。**

**目标**：一屏内回答四个问题——① 这个交易性质下最便宜是哪家 ② 线下还是线上便宜 ③ 差多少 ④ 有没有不能直接比的东西（折算 / 税口径）被排除了。

```
┌ 物料库 / 灯光音响 AV / LED 屏 P3.91 室内租赁                                        ┐
│ LED 屏 P3.91 室内   500×500 箱 · 比价基准单位 ㎡ · [租赁·按天]  [编辑] [新增报价 +]   │
│ 别名 LED大屏 · 淘宝参考 ↗ · 参考图 · 7 家供应商 · 最近更新 今天 09:24                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ 数量 [ 100 ㎡ ] [ 300 ㎡ ] [ 500 ㎡ ]  自定义 [ ] ㎡   按 300 ㎡ 计算 口径:含税v [表格]│
├────────────────────────────────────────────────────────────────────────────────────┤
│ [租赁·按天  3 家  最低 ¥500/天] [买断  2 家  最低 ¥8,000] [定制加工  1 家  只有 1 家] │
├────────────────────────────────────────────────────────────────────────────────────┤
│ 最便宜 ¥500.00 星光灯光（租赁商）｜ 次低 ¥560.00 城东工装 ｜ 同口径可比 2 家          │
│ 线上只有 1 家（淘宝-演艺设备）且单位没折算，没法比线上便宜还是线下便宜                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─[最低] 租赁商───────────┐ ┌─ 租赁商 ─────────────┐ ┌─ 线上电商 ───────────┐      │
│ │ 星光灯光        今天 09:24│ │ 城东工装      09-02  │ │ 淘宝-演艺设备 148天   │      │
│ │ ¥500.00                 │ │ ¥560.00              │ │ ¥420.00              │      │
│ │ /㎡/天 · 不含税 · 起订1㎡  │ │ /㎡/天 · 不含税 · 起订1│ │ /㎡/天 · 不含税      │      │
│ │ 无阶梯                   │ │ 无阶梯                │ │ (!) 未折算 · 不能比  │      │
│ │ 交期 1 天 · 长期有效       │ │ 交期 2 天             │ │ 单位不一致，不参与排序│      │
│ │ ── 近 12 月 ──  展开 v   │ │ ── 近 12 月 ─ 展开 v │ │ ── 展开 v            │      │
│ └─────────────────────────┘ └──────────────────────┘ └──────────────────────┘      │
│                                                                                    │
│ v 已失效 / 历史价（3 条，不参与比价）                                               │
├────────────────────────────────────────────────────────────────────────────────────┤
│ 已选 星光灯光 · 租赁·按天 · 300 ㎡ · 成本 ¥150,000    [毛利率 40%] [攒进报价单 →]    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

> **线框图读法**：这张图上的物料有 3 种交易性质，所以**有 Tab**。90% 的物料只有一种性质（喷绘只有定制加工、桁架只有买断、音响只有租赁），那**整条 Tab 不出现**，`租赁·按天` 只作为主体信息区里的一个小徽章，卡片区直接顶上去多出 40px。**多数人永远见不到 Tab，少数人见到就必须分段——这个开关成本是零。**

#### 交易性质 Tab `<NatureTab>`（v1.2 新增，PM 明确要求"Tab 必须在摘要条之上"）

| 项 | 规范 |
|---|---|
| 出现条件 | 该主体有 **>1 种** `pricing_nature` 时出现；只有一种时**整条不渲染**（不显示一个只有一个选项的 Tab） |
| 位置 | **数量档切换条之下、摘要条之上**（PM 明确：摘要条必须跟随选中性质，所以 Tab 必须在上） |
| 高度 | 40px（`--cmp-nature-tab-h`）；选中项 2px 朱砂下边线 + `--fg` 590；未选中 `--fg-3` 510 |
| Tab 内容 | `租赁·按天  3 家  最低 ¥500/天` —— **每种性质把自己的组内最低带宽显示在 Tab 上**。这一手把原方案的"跨组速览摘要条"折叠掉了：用户不用滚动、也不用切 Tab 就知道其它性质大概多少钱，但**不会误以为它们可以互相比较**（数字旁边就是性质名） |
| 顺序 | 固定 租赁 → 买断 → 定制（活动公司 90% 是租，租排第一减少滚动）；有数据的性质才出现 |
| 默认选中 | 该主体的 `default_pricing_nature`（建物料时定）；未定时选"有有效价最多的那个性质" |
| 无最低的性质 | Tab 上写 `口径不一致` 或 `只有 1 家`，**不编一个"最低"出来** |
| 与 `qty` 的关系 | 切换 Tab **不重置**数量档（同一个数量在租/买两种性质下都要看） |
| 埋点 | `compare_nature_switched`，带 `from` / `to` |
| 键盘 | `←` `→` 在 Tab 间移动（与数量档的 `←` `→` 冲突时，Tab 获得焦点后才响应，数量档不抢） |
| 分段维度（**v1.7 换了基准，这条改的是数据来源，不是文案**） | 这排 Tab 的维度是 **`pricing_nature` + `unit_mode`**，按此顺序取第一个非空维。<br>① 物料且单位不是时间类（㎡/块/张）→ `unit_mode` 为 null，**退化成按交易性质切，物料侧线框不变**；<br>② 物料且单位是时间类（天/场/小时）→ 出现「租赁·按天 / 租赁·按场」这样带计价方式的 Tab；<br>③ `item_type === 'personnel'` → `pricing_nature` 恒为枚举第四值 **`service`**（不是 null），没有可比对象，**只按 `unit_mode` 分段**（`per_day` 按天 / `per_event` 按场 / `per_person_day` 按人天 / `per_hour` 按小时 / `per_half_day` 按半天）。<br>Tab 上显示 `分段名 + N 家 + 组内最低`，三段规则一样：**组件一个、维度一个、文案表两套** |
| **基准必须是这一条价自己的 `unit_mode`，不是主体的 `items.pricing_mode`**（v1.7 改正，PM 给的基准我之前写错了） | 反例（架构给 PM 的，我原样抄进来）：一位按「人天」备案的讲师，A 经纪**按场**报 ¥2,800。主体默认 = 按人天，但这条价实际按场。**按主体分组 → A 的 2,800 被归进「按人天」组，和别人的「按人天 1,500」一起标最低**——这正是本次要修的那个事故，只是换了个入口又回来。<br>所以：`items.pricing_mode` **只做表单默认值与列表展示，绝不参与比价分组**；分组一律读 `prices.unit_mode`（后端生成列，前端只读）。 |
| 同一主体在分段里"有的组有他、有的组没有" | **这是现实，不是数据缺失**。一个人按场报过一次、按天报过两次，就会出现两组有他、其它组没他。界面**不加"数据缺失""请补全"提示**，也不做"这个人缺 3 种计价方式"的完整度评分。 |
| 组内只有 1 家 | **不标 `最低` 徽章**，Tab 上写 `1 家`、不写"最低"，摘要条第 1 行走 N=1 的文案（`只有 1 家能比：¥2,800 张启明`）。唯一一家标最低等于没说，还会让人以为"这家最便宜"。 |
| 主体默认与单条报价不一致 | **合法现实，系统不报警、不纠正、不提示**（TC-3B.8）。不出现「与默认计价方式不一致」这类琥珀提示——按场报一次是正常的商务行为。 |

#### 三个"计价方式"字段的分工（v1.7 钉死，PM 6.4 对照表 · 前端只碰其中两个）

> **一句话记法：短码是「单位本身」，带前缀是「按什么计价」。** 两套并存就是必现 bug，所以这里一次说清谁是谁。

| 字段 | 形态 | 我该拿它做什么 | 能不能写 |
|---|---|---|---|
| `prices.unit_code` | 短码 `day` / `session` / `person_day` | **录价表单里计价单位的选项值**（下拉的 `value`） | **可写** |
| `prices.unit_mode` | 带前缀，**值域只有 5 个**：`per_day` / `per_event` / `per_person_day` / `per_hour` / `per_half_day`；**非时间类单位为 `NULL`** | **分组与展示**：Tab 分段、列表页多行、自检第 3 条的"同计价方式"、卡片单位行 | **只读**（后端生成列，前端读不到写口） |
| `items.pricing_mode` | 带前缀，同上值域 | **只做**两件事：录价表单的默认选中项、主体列表页的展示 | 不落库（派生值） |

- **`items.pricing_mode` 绝不用于比价分组**（见上一张表的反例）。它不是错的值，它是**主体的**值——拿主体的值去给单条报价分组，就是把"档案默认"当"这一条的事实"。
- 前端需要两套码表：`unit-code.ts`（短码 → 中文，表单用）与 `unit-mode.ts`（带前缀 → 中文，展示用）。**不做运行时互转**——两个值都由后端给，前端互转就是自己造了一次映射机会。
- 我 v1.6 写的 `pricing_mode` 5 值英文码（`per_*`）保留，只是**它现在只服务展示与表单默认**，不再服务分组。
- **`unit_mode` 没有 `per_sqm` / `per_sheet` / `per_piece` 这类值**（架构 ③）。**非时间类单位一律 `NULL`**，前端不许为它编一个 `per_*`。这条不是命名洁癖，它有两个真实后果：
  1. 编出来就会**按单位分裂成两组**——`per_sqm` 与 `per_sheet` 本来是同一个价（一张 = 0.25㎡），分两段等于把一组拆成两组互相比不了；
  2. 物料行的 `unit_mode` 传参是 **`null`**，`per_sqm` 匹配不上，**物料侧的价格会被整批过滤掉**（页面空白，且不报错）。
- 所以 `unit-mode.ts` 码表就是 **5 项 + NULL**，非时间类单位**不生成 label**；列表页/卡片遇到 `unit_mode IS NULL` 时，展示退回 `unit_code` 的中文（`㎡` / `块` / `张`），**不拼"按㎡"**。

#### 三种"不能直接比"的情形（统一处理，用户只需记一条规则）

> **口径不一样的东西，我不给你标最低，但我都给你列出来。**
> 这句话是这一屏的认知模型，三种情形共用同一套视觉语言：**琥珀提示 + 不给最低徽章 + 不排序 + 仍然可见可选**。

| 情形 | 判定 | 展示 | 可否攒单 |
|---|---|---|---|
| **单位不一致 · 未填折算** | `unit ≠ item.compare_unit` 且 `base_unit_qty IS NULL` | 单价旁琥珀 `未折算` 徽章；卡片排在已折算行之后；单价正常显示原值 | **可以**，攒单时提示"按原单位 X 张计入" |
| **单位不一致 · 已填折算** | 同上但 `base_unit_qty` 有值 | **大字号显示折算价** `¥60.00/㎡`，下方 11px 灰字 `原报 ¥5.00/张（1㎡ = 12 张）`——**原价必须看得见**，否则用户不知道 60 是怎么来的，会不信 | 可以，按折算价计入 |
| **税口径不同（含税价 / 不含税价并存）** | 同一组里同时存在 `tax_included = true` 与 `false` | **不是"不标最低"，是"只在一个口径里比"。** 页面有一个 `口径：含税 / 不含税` 切换（默认取设置项的默认口径声明），比价只在选中口径内排序、标最低；另一口径的卡片**仍然显示**，但角标写 `只有不含税价`、置底、不进最低价、不参与"同口径可比 N 家"计数 | 可以，攒单时按该行自己的口径计入，并提示「这行是不含税价」 |

> **v1.3 修正：税口径不再是"两边都不标最低"，而是"一次只比一个口径"。**
> PM 的 TC-4 把这件事改对了：同一个供应商同时报"要票 113、不要票 100"是行业常态（TC-4.1），所以两条价必须能并存；而"并存"不等于"不能比"——`resolvePrice(tax_basis)` 返回单值，比价页只需要知道**当前按哪个口径比**（TC-4.4/4.5）。
> 我上一版做的"整组不标最低"是错的：它把一个可解的问题（选个口径）变成了一个无解的问题（永远没有最低价）。现在的模型下，**摘要条上的 `同口径可比 N 家` 天然就是「这个口径里有几家能比」**，一个字都没多写。
> 口径来源（TC-4.8）：比价页取设置项的默认口径，可在页面上切；**报价单里取本单的口径声明，不由用户逐行选，零操作**。

- 折算方向（PRD §6.6.2 明确）：**折算单价 = `unit_price × base_unit_qty`**，是乘法。前端**不许写成除法**，这是最容易搞反的一处，接口必须直接返回 **`base_unit_price`**（不是 `normalized_price`，架构已定名）让前端只做展示。
- 并列最低：两家都标 `最低 · 并列`，但**并列双方必须单位折算后一致且税口径一致**，否则不算并列（PRD §6.6.3）。
- 三种情形共用一句兜底文案（出现即用户只需理解一次）：`口径不一样，我不给你标最低，但都列在这儿了。`

**`tax_basis` 与 `tax_included` 是两件事，界面上不能混（架构 ①，v1.6 落）**

| | 谁 | 含义 | 我的界面用法 |
|---|---|---|---|
| `tax_basis` | **请求参数**（必传） | 「我**要按**哪个口径看」 | 页面那个 `口径：含税 / 不含税` 切换器的值，切换即重发请求 |
| `tax_included` | **响应行的属性** | 「这条价**本身是**哪个口径」 | 只用于画卡片角标 `含税` / `不含税`。**绝不拿它拼请求** |

> 这条写进文档是因为它是最容易出现"两种写法都跑得通、但其中一种是错的"的地方：拿 `rows[0].tax_included` 回填切换器，第一次点开会碰巧正确，第二个供应商口径不同时就静默变成按错口径比。**它不报错。**

**比价降级原因枚举：认 `reason` + `basis_dimension` 两个字段，不认文案（架构 ③，v1.6 改）**

| `reason` | 场景 | 界面文案（我的，可改） |
|---|---|---|
| `MIXED_BASIS` | 组内口径混排、请求没指定口径 | `这 3 家的口径不一致，选一个口径再比` |
| `ONLY_OTHER_BASIS` | 指定了口径，但部分供应商只有另一口径 | `丁 只报了不含税价 2,900，不计入这个口径` |
| `NO_COMPARABLE_UNIT` | 单位不一致且没填折算 | `单位不一致，填了换算关系才能比` |
| `SINGLE_ROW` | 只有一行能比 | `只有 1 家能比，再录一家才看得出贵不贵` |

- 另读 `basis_dimension: 'tax' | 'unit' | 'nature' | 'pricing_mode' | null` 说明是哪一维不一致。**`reason` 泛化过一次**：原来带 `TAX` 前缀的两个码（`TAX_BASIS_MISMATCH` / `TAX_BASIS_MISMATCH_ONLY`）已废弃，因为 PM 把「口径不一致不能比」从含税一处升成了通则（跨单位 / 跨性质 / 跨计价方式统一处理），带 `TAX` 的码在另外三个场景里读起来就是错的。
- **前端不得按字符串前缀判断场景**（不许 `reason.startsWith('TAX')`），只做**精确匹配 → 文案映射表**，未命中的 `reason` 一律退回兜底文案 `口径不一样，不给你标最低`，不白屏、不抛错。
- 文案表放 `src/domain/compare-reason.ts`，与 `quote-status.ts` 同级；新增 `reason` 值只改这一个文件。


#### 价格状态四级（PRD §6.6.4，颜色与行为完全不同）

| 级别 | 条件 | 颜色 | 在比价页的位置 | 可否出单 |
|---|---|---|---|---|
| **有效** | 在 `[effective_from, effective_to]` 内，且 `max(updated_at, last_used_at)` 距今 **≤** 阈值（默认 90 天，**恰好等于 90 天算有效**，TC-5.6） | 正常 | 组内正常参与排序 | 可以 |
| **软陈旧** | 有效期内，但 `max(updated_at, last_used_at)` 距今 **>** 阈值（91 天起，TC-5.7） | 琥珀 `(!) 123 天未核价` | **仍参与排序、仍可攒单**，不弹窗 | 可以，内部版导出留痕 |
| **硬失效** | `effective_to < 今天` | 灰（比价页）/ 红（出单命中时） | **移出比价分组**，收进底部折叠区「已失效 / 历史价」 | 不可以 → 出单转红阻断 |
| **被替代** | `status = superseded` | 灰 | 同上，折叠区；同时进历史趋势图 | 不可以 |

- **软陈旧的计时起点是 `max(updated_at, last_used_at)`**，不是单纯的 `updated_at`。一个价 187 天没改但上周刚用过、客户也没投诉，说明它大概率还有效——这时候提醒它过期是纯噪音。**用户一旦对提醒脱敏，所有提醒都会被忽略，包括真正重要的那些。**
- 比价页把硬失效/被替代价格**移出分组**（而不是灰着留在组里），是为了让"这一组里都是能用的价"成为一个可依赖的前提。
- 折叠区展开后是一张密表：`供应商 / 类型 / 单价 / 失效日 / 状态`，行高 32px。

#### 最低价的五重编码（同性质内，不靠颜色单独传达）

| # | 手段 | 实现 |
|---|---|---|
| 1 | 位置 | 同性质内排第一（左上） |
| 2 | 摘要条第 1 行 | 点名 + 供应商类型 |
| 3 | 徽章 | 卡片顶部 `最低` 徽章（绿底绿字 11px）+ 类型标签 |
| 4 | 字号 | 单价 26px 590 vs 其它 22px 510 |
| 5 | 描边与底 | 2px `--price-lowest-border` + `--price-lowest-bg` |

#### 顶部摘要条（44px，本页第一落点，跟随选中的交易性质）

> PM 说它是"本页最重要的落点"，我认同，但我上一版做错了一件事：把它做成**跨性质速览**（"买断 8,000 / 租赁 500/天 / 定制 1,200"并列）。**那等于在鼓励用户跨性质比较**——正好是 PRD §6.6.1 要防的事故。v1.2 修正：**跨性质速览折叠进 Tab（见上），摘要条只讲当前这一个性质。**

```
最便宜 ¥500.00 星光灯光（租赁商）｜ 次低 ¥560.00 城东工装 ｜ 同口径可比 2 家
线上只有 1 家（淘宝-演艺设备）且单位没折算，没法比线上便宜还是线下便宜
```

**两行的分工，一个字都不能换位**

| 行 | 回答什么 | 写法规则 |
|---|---|---|
| 第 1 行 | 这个性质下最便宜是谁、次低是谁、**这个结论建立在几家上** | `最便宜 ¥X 供应商（类型）｜ 次低 ¥X 供应商 ｜ 同口径可比 N 家` |
| 第 2 行 | 线上 vs 线下——**这才是报价员心里真正的问题** | 有可比数据时：`线上最低 ¥X（供应商）｜ 线下最低 ¥X（供应商），线下便宜 12.5%`；数据不足时直接说为什么没法比 |

**文案的两条死规则（PM 逐条点名）**

1. **金额和百分比二选一，不许并列。**
   **别写** `比最贵便宜 ¥12.00（30%）` —— 括号里的 30% 到底指什么？没人说得清。
   **写成** `比最贵便宜 30%` 或 `比最贵便宜 ¥12.00`，**选一个**。默认选百分比（人对比例更敏感），但价差 < ¥10 时改用金额（"便宜 3%"听着像没便宜）。
2. **必须带"同口径可比 N 家"。** 只有 1 家可比时，"最低价"是没有意义的，但摘要条会给它一种虚假的权威感——**这是比价类界面最容易骗人的地方**。

**N 的四种取值，四种文案（前端照此实现）**

| N | 第 1 行怎么写 | 第 2 行怎么写 | 卡片徽章 |
|---|---|---|---|
| **N ≥ 3** | `最便宜 ¥500.00 星光灯光（租赁商）｜ 次低 ¥560.00 城东工装 ｜ 同口径可比 3 家` | 按上面的线上/线下规则 | 正常标 `最低` |
| **N = 2** | 同上，`同口径可比 2 家` | 同上 | 正常标 `最低`（2 家比价是有效的） |
| **N = 1** | `只有 1 家能比：¥500.00 星光灯光（租赁商）` —— **不出现"最便宜"三个字** | `再录一家才看得出贵不贵` | **不标 `最低` 徽章**，卡片单价用正常字号 22px，不用 26px |
| **N = 0** | `这一组没有能比的价：3 家单位或税口径不一致` | `[填换算关系]` / `[补税口径]` 两个文字按钮 | 全卡琥珀 `未折算` / `含税` 角标 |

- **44px 里塞两行**：第 1 行 13px / `--fw-semibold` / `--fg`，第 2 行 11px / `--fg-3`，行距 16 + 14，上下内边距 6 → 合计 42，余 2px 给边框。够。
- 摘要在**滚动时吸顶**（`position: sticky; top: 0`），因为它承载的是"结论"，结论不能滚出去。
- 这是全屏**唯一"必须被读完"的元素**，所以它是全页唯一允许用 16px 字号的地方（第 1 行在 ≥1440 时升到 16px）。
- 埋点：`compare_summary_clicked`（点摘要条任意一处 → 滚动到对应卡片并高亮 300ms）。


#### 数量档切换器（PRD §7.2 关键交互）

```
数量 [ 100 ㎡ ] [ 300 ㎡ ] [ 500 ㎡ ]  自定义 [    ] ㎡        按 300 ㎡ 计算
```

- 分段控件 36px + 自定义输入 72px；档位来自该主体全部供应商阶梯价断点并集，最多 4 个。
- 切换后：所有卡片命中价 150ms 更新（数字淡出淡入）→ 卡片在**同性质内**重排（FLIP 200ms）→ **Tab 上的各家最低价与摘要条同步刷新**（注意：重排只在当前性质内，不跨 Tab）。
- 键盘 `←` `→` 切档，敲数字跳进输入框，`Enter` 确认。
- **命中规则 5 种情形**（前端照此实现，不得自作主张）：

| 情形 | 取值 | 卡片标注 |
|---|---|---|
| qty ∈ [min, max) | 该档单价 | `命中 300–499 档`（绿字） |
| qty ≥ 最高档 min | 最高档单价 | `已享最高档` |
| qty < 起订量 | 不可选 | 整卡降灰 + `(!) 起订 200㎡，按 100㎡ 不满足` + 卡片内置底 |
| 无阶梯价 | 统一单价 | `无阶梯`（灰字） |
| 档位有断档 | 取 ≤qty 的最近有效档 | `按 10–29 档计`（琥珀） |

- `rental_daily` 的卡片单价显示 `¥500.00 /㎡/天`，**摘要条第 2 行末尾**额外显示 `按 300 ㎡ 折 ¥150,000`（= 单价 × 数量 × 天数；天数取报价单的活动天数，无活动天数时显示 `按 1 天计`）。**这是防止"按天价被当成一次性价"的关键防呆**——一个 `¥500` 和一个 `¥150,000` 摆在一起，没人会看错。
- 同一防呆在 Tab 上也出现一次（`租赁·按天 3 家 最低 ¥500/天 ≈ ¥150,000`），因为用户可能在切 Tab 之前就先读 Tab。

#### 卡片可展开：该供应商此主体的历史价格

- 卡片底部 `近 12 月  展开 v`，展开 120px 迷你折线（无坐标轴、2px 线、`--chart-2`、右上角涨跌百分比）。
- **趋势走独立接口，不准塞进比价接口**：`GET /items/:id/price-trend?from=&to=&pricing_nature=`。理由（架构给的，我认同）：5 家 × 12 个点会把比价接口变成"顺带出趋势"的胖接口，缓存键还会被日期污染。
- 因此**首屏体验是两段式**：比价接口只出价格与阶梯（单表 Index Scan，1.5s 内必然到）→ 卡片立刻可读可点 → 迷你图在展开时才请求，先给 120px **固定高度的骨架占位**（高度先占住，避免展开时整块跳动 → CLS）。
- 骨架是 12 个等高竖条淡入淡出（不是转圈），因为它要占的是一条折线的位置，转圈会误导"这里有个控件"。
- 趋势加载失败**不影响价格可用**：卡片底部降级成 `趋势没加载出来 · 重试`，不弹错误。**价格是主功能，趋势是附加，附加功能失败不许污染主功能。**
- 历史线**包含硬失效与被替代的价格**（那段历史是真实的），但用实线 + 灰点区分，hover 标注 `2025-03-11 ¥3,200（已失效）`。
- 卡片区独立滚动，页面在 768 高度下无纵向滚动条。
- 右下角 `看完整趋势 ↗` → 400px 抽屉（多供应商对比线 + 区间切换 + 数据表）。
- 展开即上报 `price_trend_viewed`。

#### 表格视图（次选）

右上角切换，`供应商 / 交易性质 / 类型 / 单价 / 折算价 / 命中档 / 含税 / 起订量 / 交期 / 状态 / 更新`，**分组分隔行与 Tab 保持一致**（表格视图里保留性质列 + 分隔行，因为表格可以纵向滚动看全，不像卡片受 Tab 限制）。冻结前两列，给数字党用，不作默认，共享 `qty` 状态。

#### 1366×768 与 1440 布局预算

| 区段 | 单性质物料（90% 情况） | 多性质物料（LED 屏这类） |
|---|---|---|
| 顶栏 | 52 | 52 |
| 主体信息区（含性质徽章） | 64 | 64 |
| 数量档切换条 | 44 | 44 |
| **交易性质 Tab** | **不渲染 · 0** | **40** |
| 摘要条（两行） | 44 | 44 |
| 卡片区（`flex:1`，独立滚动） | **460** | **420** |
| 底部操作条（吸底） | 64 | 64 |
| 页面上下内边距 | 40 | 40 |
| 合计 | 768 | 768 |

- **单性质（绝大多数）：卡片区 460px，正好放 2 行满宽卡片**（208×2 + 16 gap = 432，余 28 给滚动条与呼吸）。没有组头、没有 Tab——**90% 的用户看到的是一个干净的、只有卡片和结论的页面**。
- 多性质：卡片区 420px，仍是 1 行整 + 第 2 行可见上半（208+16+208=432，差 12px）。**接受滚动**——因为分段带来了信息层级与防亏钱保护，一屏塞不完是合理代价。
- **不想让 Tab 白占 40px 的做法**：Tab 只在真需要时渲染，而不是"永远渲染但只有一项"。这条比"把 Tab 做窄"重要得多。
- 列数：`repeat(auto-fill, minmax(248px,1fr))`，gap 16。1366（内容区 1102）→ 4 列；1440（1176）→ 4 列；1920（1600 上限）→ 6 列。**1366 无横向滚动条**。
- 同性质内只有 1–2 家时，卡片**不拉伸铺满**，保持 248px 宽度左对齐——等宽是跨卡片数字对齐的前提（见 §D.1.1）。


---

### C.4B 录价（新增报价）抽屉 `<PriceEntryDrawer>` **【出稿优先级 3 · 生死线】**

> PRD §7.1 写死：**默认只露 4 个必填**（供应商 / 单价 / 生效日 / 单位），其余全部折叠。录价路径每多一个必填，录价意愿就掉一截。
> v1.1 相对上一版的修正：上一版把"添加供应商报价"当成详情页里的次要动作，这是错的。录价是**独立的、被反复执行的高频动作**，必须是抽屉而不是 Modal，且必须支持连续录入。

```
┌ 录一条价 ────────────────────────────────────────────────── 背景板 6×3m 桁架喷绘 ┐
│                                                                                  │
│  供应商 *                                                                        │
│  [ 金桥桁架厂                                                    v ]  [新建 +]   │
│                                                                                  │
│  单价 *                        单位 *                    生效日 *                 │
│  [ 28.00        ] 元           [ ㎡        v ]          [ 2026-11-04      ]      │
│                                                                                  │
│  ┌ 展开更多（含税价 · 起订量 / 阶梯价 / 参考图 / 外链 / 来源备注 / 交期）──  + ──┐ │
│  ↑ v1.15：折叠条上带出当前税口径。口径藏在折叠区里，用户就不知道这条价是按什么记的 │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  (!) 这家在 2025-01-01 起有一条 ¥32.00 的价（长期有效）。保存后旧价将在此结束：    │
│      2026-11-04。  [ 确认，结束旧价 ]   [ 改生效日 ]                              │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                      [ 取消 ]  [ 保存并再录一家 ]  [ 保存 ]       │
└──────────────────────────────────────────────────────────────────────────────────┘
                480px 右侧抽屉 · 内容区可滚 · 底部按钮吸底 64px
```

**4 个必填的定义（一个字都不能多）**

| 字段 | 控件 | 默认值 | 说明 |
|---|---|---|---|
| 供应商 * | 可搜索下拉（支持"新建供应商"内联） | 空，且**自动聚焦** | 搜索范围含联系人/别名；无匹配时下拉底部常驻 `+ 新建「XXX」` |
| 单价 * | 数字输入，`--font-num`，右对齐 | 空 | 支持 `1,200` / `¥45` / `1.2万` 解析（规则见 §E.2） |
| 单位 * | 下拉，11 个枚举（PRD §6.4） | **继承主体单位并锁定** | 用户若改成别的单位，展开区自动展开并强制填 `base_unit_qty`（选填；不填则该价标"未折算、不能比"，仍可保存） |
| 生效日 * | 日期选择 | **今天** | `effective_to` 留空 = 长期有效，不占必填 |

> **交易性质 `pricing_nature` 不进必填，改为「按分类预填 + 录价时可见可改」（PRD v1.8 / 客户 Q2）。** 理由：它影响比价分组（PRD §6.6.1），是**物料属性**而不是单条价格属性——LED 屏到底是买是租，建物料时就该定。所以：
> - **预填值来自分类**（`categories.default_pricing_nature`，不是全局默认）：设备器材（LED / 音响 / 灯光 / 桌椅 / 投影 / 发电机 / 空调）→ `租赁价·按天`；定做（桁架 / 背景板 / 喷绘 / KV 板 / 礼品定制）→ `定制加工价`；标品（伴手礼 / 饮用水 / 耗材）→ `买断价`。
> - **预填值必须可见可改**：录价抽屉顶部是一枚**可点开的下拉**（不是只读徽章），当前值直接显示 `租赁·按天`。灰掉的默认值是最坏的形态——用户会以为系统已经替他定好了。
> - **在单条上改，不改分类默认值**。改了只影响这一条价（这正是多性质物料的存在理由），分类默认值只在设置页改。保存后 Toast 不提示这件事——它不是需要用户知道的后果。
> - **人员侧没有这个字段**：`item_type === 'personnel'` 时**不渲染、不给选**——服务态的 `pricing_nature` **恒为第四值 `service`**（架构 ②）。**不出现这个选项**，不是因为它不存在，而是因为**只有一个合法值的下拉是假选择**：用户点开只看到一项，会以为是自己理解错了。
> - 所以录价抽屉在这里按 `item_type` **分叉**，且**两侧下拉项数量不同**：物料侧「交易性质」**三值**（`purchase` / `rental_per_day` / `custom_made`），人员侧「计价方式」**五值**（`unit_code` 短码：`day` / `session` / `person_day` / `hour` / `half_day`）。**两个下拉不同时出现**——同时出现会让用户以为一个物料能既按性质又按计价方式分组。
> - 极端情况（同一物料既有买断又有租赁，如 LED 屏）→ 物料可开启"多交易性质"，此时录价抽屉里 `pricing_nature` 变成**必填单选**（必须明确这一条价是哪一类）。这是唯一会变 5 必填的场景，且由用户自己开启。

> **客户 Q2「以租赁为主」对录价界面的影响（v1.6 落）**：设备器材类的 `pricing_nature` 默认落在 `租赁价·按天`。于是**阶梯价区的单位提示要跟着性质走**，不能一律按"数量"说：
> - 性质 = `rental_per_day` → 阶梯区标题写 `阶梯价（按天，天数为阶梯）`，首个空档 placeholder `如：租 3 天以上通常有折`；
> - 性质 = `purchase` / `custom_made` → 沿用按数量（`100 – 499 ㎡`）。
> 这条**只改 placeholder 与标题，不改校验、不改数据结构**。做法上按 team-lead 的意见用 placeholder，不用常驻提示语——常驻提示语会被当成"系统建议我打折"，而 placeholder 只是"告诉你这一格该填什么"。

**录 `internal`（自有团队 / 自有人员）的价格，字段提示必须点明它是什么（TC-4D.2）**

```
单价 *                        单位 *
[ 1,200.00      ] 元           [ 人天      v ]
  内部成本折算 · 不是对外支付
```

| 项 | 规范 |
|---|---|
| 出现条件 | 选中的供应商 `type === 'internal'`，**且** `item_type === 'personnel'` 或该供应商是我们自己的队伍 |
| 提示文案（固定，不可省） | **`这是内部成本折算，不是对外支付`** —— 10 个字以内说清"这个数字不会付给任何外部方" |
| 位置 | 单价输入框正下方 11px `--fg-3`，**不是什么 hover 提示**——要一眼看到 |
| 为什么必须有 | 自有人员的"单价"是自己的人力成本摊销（工资 + 社保 ÷ 可出勤天数），不是一个可支付的报价。**不写这句，报价员会把它当成市场价去对外报，或者拿它和经纪公司的报价直接比出"自己人更贵"这种没头没尾的结论** |
| 不做什么 | 不弹确认、不拦截保存、不改灰、不加图标警告。**它是事实说明，不是错误提示**——自有成本并不比外聘差，只是不同 |

**比价卡片必须显式区分「自有 / 外聘」（TC-4D.4）**

- 卡片徽章区右侧原来只显示供应商类型（`经纪公司` / `灯光音响商` …）。`internal` 的卡片在这枚徽章**之前**多一枚 `自有` 徽章（`--badge-internal-bg` 底 + `--badge-internal-fg` 字，11px），其它供应商显示 `外聘`。
- 只给 `internal` 打 `自有`，外部的不加第二枚徽章——**「不一样的那个才需要标」**，全体都标等于没标。
- 摘要条第 1 行若最低价来自 `internal`，写成 `最便宜 ¥1,200.00 自有项目经理（自有）`，把口径直接写在结论里。
- `item_type === 'personnel'` 的卡片，单位行追加 `自有 / 外聘` 作为第四段：`/人天 · 不含税 · 起订 1 · 自有`。

**「展开更多」内折叠的 8 项**（默认全部收起，收起时折叠条不显示已填值，保持干净）

```
含税         [●——]          默认：含税（开）
                            ↑ v1.15 从「默认不含税、记住上次选择」改过来：
                              供应商报过来的价基本都是含税的，客户版报价单也一律按含税算；
                              而「记住上次选择」会让给某一家关过一次之后，后面每一家都静默记成不含税。
                              取价按口径严格匹配、不回落 → 含税单子里就变成"没有有效价格"，
                              人还找不到原因（价明明录了）。所以：默认含税，关抽屉即复位。
最小起订量    [    10 ] ㎡    默认空 = 无起订量
阶梯价        [ 添加一档 + ]
              100 – 499 ㎡    ¥28.00    [x]
              500 ㎡ 以上     ¥25.00    [x]
交期          [    3  ] 天
折算          1 ㎡ = [ 12  ] 张   （仅当单位 ≠ 主体比价单位时出现，选填）
              ↑ 界面上一律用问句「1 ㎡ = 多少张？」，× 不出现"换算系数"四个字
                问句天然消除方向歧义（是乘还是除？），用户按平时说话的方式填就行
                语义固定：1 个比价基准单位 = 多少个本价格单位；折算价 = 单价 × 系数
参考图        [ 拖入或点选图片 ]  单张 ≤5MB，仅 jpg/png/pdf
外链          [ https://item.taobao.com/... ]
来源备注      [ 2026-10 老王微信问价                        ]
```

**折算这一格的三个防错（TC-2.10 ~ TC-2.13，全是"看起来能填其实一定错"）**

| 用户填的 | 系统反应 | 文案 |
|---|---|---|
| 单位 ≠ 基准单位，但填了 **1** | **拒绝保存（422）** | `1 张 = 1 ㎡ 的话，直接把上面的单位改成「㎡」就行，不用填折算。` —— 逻辑上恒为错：真 1:1 就不该出现两个单位（TC-2.10） |
| 填了 **小于 1** 的数（如 0.2） | 不接受，反向提示 | `0.2 张 = 1 ㎡ 是说反了吧？建议把比价单位改成「卷」：1 卷 = 5 ㎡。` —— 小数答案 99% 是单位选反了（TC-2.13） |
| 单位 = 基准单位，一格不填 | **允许**，视为不折算 | 无提示（TC-2.11） |

- `base_unit_qty` **必须可空，没有默认值 1**（TC-2.12）。默认 1 的后果是：所有没填的行都被静默当成"单位一致"，比价结果全错而且没人看得出来。**「没填」= 不可比，「填了 1」= 谎称单位一致，这两件事不能混。**
- 这一格只在单位 ≠ 基准单位时出现。单位一致时它**不渲染**，而不是渲染成灰色——灰着的输入框会让人以为"这里要求填点什么"。

**阶梯价用内联小表格，不做 wizard**（PRD 明确要求）
- 3 列：`起` / `至` / `单价`，行可增删（`+ 添加一档`、行尾 `x`），行高 36px。
- `至` 留空 = 该档无上限。
- 实时校验（**警告，不阻断**）：① 档位重叠 → 行底琥珀 ② 高档单价高于低档 → 行底琥珀 + 提示「第 2 档 ¥32 比第 1 档 ¥28 还贵，确认吗？」 ③ 有断档 → 提示「30–99 ㎡ 没有价格」。
- 快速填充：新行默认 `起 = 上一行至 + 1`；提供 `从上一档 -5%` 快捷按钮（采购常按比例砍价）。
- 保存时若阶梯全部为空 → 不写阶梯表，走统一价，阶梯区不产生垃圾数据。

**人员模式的差异（`item_type === 'personnel'` 时动态渲染）**
- 必填仍是 4 个，但 `单位` 换成 **计价方式**（5 选 1 分段控件：`按天` / `按场` / `按人天` / `按小时` / `按半天`）。
- 展开区**多 1 项**：`是否含差旅`（开关，默认关）。开启时必填区下方出现一行 11px 说明「含差旅 · 异地活动成本已包含在单价里」——这是防止报价漏成本的关键提示。
- `按人天` 时在数量旁给一行灰字提示：`按人天 = 人数 × 天数，MVP 不自动换算，请直接填结果（3 人 2 天填 6）`。

**保存路径与重叠确认（轻量，不阻断）**
- 点「保存」→ 服务端校验该「主体 + 供应商」是否有生效期重叠的旧价。
- 有重叠 → **不用 Modal，用抽屉底部的内联提示条**（琥珀底，44px 高，见线框图），文案明确写出：旧价金额 + 旧价生效日 + 旧价结束日（= 新价生效日 − 1 天）。
- 两个动作：`确认，结束旧价`（主）/ `改生效日`（次，把焦点移到日期选择器）。
- 用户点确认后旧价置 `superseded`，新价立即进入比价与出单可用池，抽屉内 Toast：`录好了。金桥桁架厂 28.00 元/㎡，旧价已结束。`
- **绝不整页报错**，绝不关掉已填内容。

**「保存并再录一家」是这一屏最重要的按钮**

采购一次问价通常拿到 3–5 家报价。点这个按钮：保存当前 → 抽屉不关 → 按下面的规则重置 → 焦点回到供应商搜索框。顶部显示 `已录 2 家 · 还能接着录`。
这个路径把"录 5 家价"从 5 次开合抽屉降为 1 次。埋点 `price_created.filled_seconds` 会直接反映它的价值。

**重置规则（v1.2 精确化，PM 逐字段订正——错一项就会静默录错价）**

| 字段 | 处理 | 为什么 |
|---|---|---|
| 主体（物料/人员） | **保留** | 你在录的本来就是同一个物料的多家报价 |
| 生效日 | **保留** | 同一批询价通常同一天生效 |
| 交易性质 / 计价方式 | **保留** | 同一批询价通常同一性质（问租价的人不会突然给你买断价） |
| 供应商 | 清空 | — |
| **单位** | **必须清空** | **不同供应商的报价单位经常不一样**（淘宝按张、厂按㎡）。不清空会把上一家的单位带到下一家，制造一条"看不出来错"的静默错误——这种错比多点一次鼠标危险一百倍 |
| 单价 / 阶梯 / 起订量 / 交期 / 含税 / 折算 / 参考图 / 外链 / 来源备注 | 清空 | 都是"这家"的属性 |

- 去重保护：如果下一家选了**同一供应商 + 同一性质 + 生效期重叠**，走正常的重叠确认（见下），不静默覆盖。
- 顶部计数 `已录 3 家 · 还能接着录` 是这个按钮唯一的正反馈，**不做动画、不做音效**，数字变了就够。

**录入中的离开保护**
抽屉内有未保存内容时按 `Esc` / 点遮罩 → 二次确认 `转 3 秒，还有没保存的？` 带倒计时自动关闭。不用"确定要放弃吗"这种吓人的措辞。

**从哪进入**
1. 物料/人员详情页右上 `新增报价 +`
2. 比价页卡片 hover 出现的 `pencil`
3. 物料库列表行操作 `新增报价`
4. 工作台"价格超 90 天未更新"每行右侧 `去更新`
5. 全局命令面板 `⌘K` → 搜主体 → `录一条价`
—— 五个入口都用同一个抽屉组件，不用五个不同的表单。

**录价权限（v1.7 按 R15 = 分层开放改写：`member` 可以录，不能改）**

| 能力 | `member` 的界面 |
|---|---|
| 五个录价入口 | **全部可用、不置灰、不解释**。它现在是他的正当能力，加任何"仅管理员"字样都是错的 |
| 编辑 / 停用已有价 | 不渲染，位置上留一行 11px 灰字 `改已有的价要管理员做，你可以录一条新的` |
| 改交易性质 / 折算系数 | 同上一行，且打开录价抽屉时这两项**默认锁在预填值** |

判定取 `canCreatePrice(role)`（新建）与 `canOverridePrice(role)`（覆盖/归档）两个函数，**不合并**（见 §C.7「新建一条价」表）。

这跟「导出内部版」的处理仍然不同（那边是**置灰 + 解释**）：导出是菜单里的一项，看得见全貌才安心；录价是散在五个位置的入口，逐个挂解释会吵。**同一套权限思想，两种呈现，取决于入口的密度。**

#### 本单口径下这家没价、但另一口径有：**绝不自动换口径取价**（架构 ④，`/price-lookup`）

> **取值路径（v1.7.2 收口，别按 200 写）**：`other_basis_*` **只在 422 的错误体里**，200 不带。
> - `200` → 本口径价命中，`data` 是 `PriceLookupResult`，**不含** `other_basis_exists` / `other_basis_price`。读到就是 `undefined`。
> - `422` 且 `code = 42205` → `data` 是 `PriceLookupMiss`，里面才有 `other_basis_exists` / `other_basis_price` / `other_basis_tax_included` / `other_basis_price_id`，并回显 `item_id` / `supplier_id` / `pricing_nature` / `tax_basis` / `on_date`。
>
> 所以提示条只能在 **422 分支里**渲染，不能写成「`res.data.other_basis_price` 有值就显示」——那样这个提示永远不出现，而且不报错。
> 无论哪条路径，**`other_basis_price` 禁止回填成本框**。原因与 §A.3 第 5 条同源：换口径取到的价是"合法但错"的数——它不会报错，只会让整单毛利算漂亮然后报出去亏钱。

| 场景 | 界面 | 禁止 |
|---|---|---|
| 供应商只报了**不含税** ¥2,900，本单声明**含税** | 行内一行 11px 提示：`该供应商只报了不含税价 ¥2,900，本单声明含税——请让供应商补报，或手工填成本。` 三个动作：`手填成本` / `通知采购补报` / `看这家别的口径` | **不许**写"已自动采用不含税价"、**不许**自动把口径切过去、**不许**把 2,900 预填进成本框。本行状态仍是**缺价**（红字 + 出单禁用） |
| 反方向（只报含税、本单不含税） | 同一句镜像：`只报了含税价 ¥3,200，本单声明不含税——…` | 同上 |
| 该主体**任何口径**都没有有效价 | 走原来的 A / B 情形（从来没有价 / 全部失效），提示词不同（见 §C.7 缺价表） | 不要和"只差一个口径"混成同一句——前者是"没询过价"，后者是"问过但问错了口径"，补救动作完全不同 |

**三个字段各管一件事，不要互相替代**（v1.7.2）：

| 字段 | 用在界面哪一处 | 禁止 |
|---|---|---|
| `other_basis_tax_included`（布尔） | 决定那句提示写「不含税」还是「含税」。反方向那行就是它取 `true` 时的镜像文案 | **不许**用本单的 `tax_basis` 反推——反推等于把口径逻辑在渲染层再写一遍，两份真相迟早不一致 |
| `other_basis_price`（金额） | 只进那句提示的金额位 | **不许**进成本框、**不许**参与合计、**不许**参与毛利率 |
| `other_basis_price_id` | 「看这家别的口径」跳转的目标 id | 服务端不据此做任何计算，前端也不许拿它去二次查价（那又是一次隐式换口径） |

- 提示里的主体名、口径名一律用 422 回显的 `item_id` / `supplier_id` / `pricing_nature` / `tax_basis` / `on_date` 去查字典，**不拿请求参数自己拼**：请求参数是"我要什么"，回显是"服务端实际按什么判的"，两者不一致时（比如 `on_date` 落到了别的有效期内）以后者为准。
- 唯一的例外：**用户自己**在切换口径确认框里点了「换，重算」（§C.7），那是他显式同意按新口径重算整单，不是系统替他换。
- 埋点：`price_lookup_other_basis`（带 `needed_basis` / `found_basis`），用来量"供应商报错口径"到底有多普遍。

#### 批量核对 / 刷新价（`refresh-prices`）：**两个状态，不是一个确认框**（架构 ④）

接口多了 `dry_run`（**必传、无默认**）与 `include_manual`，也就是"先看差异清单，再确认落库"。所以界面是两步，**不许做成一个"确定要刷新 12 条价吗"的弹窗**——用户在没看到差异之前无法回答这个问题。

```
第 1 步 · 预览（dry_run = true）
┌ 核对这 12 条价 ────────────────────────────────────────────────┐
│  将变 5 条 · 不变 6 条 · 取不到价 1 条                         │
│                                                                │
│  喷绘布 550 高精   淘宝-喷绘之家   ¥28.00 → ¥31.00   +10.7%    │
│  桁架 3m 方管      金桥桁架厂      ¥45.00 → ¥45.00   不变      │
│  帕灯 54 颗 3W     星光灯光        —       取不到价            │
│  ⋯ 还有 9 条                                                   │
│                                                                │
│  [ ] 含手填成本的行（当前 2 行，默认不勾）                     │
│                                                                │
│                              [ 取消 ]  [ 确认写入 5 条 ]       │
└────────────────────────────────────────────────────────────────┘
```

| 项 | 规范 |
|---|---|
| 第 1 步必须能取消 | 预览是**只读**的，取消不产生任何副作用。按钮写 `取消`，不写 `关闭`（"关闭"让人以为已经改了一半） |
| `include_manual` 的呈现 | 是一个 **checkbox，默认不勾**，旁边常驻 `含手填成本的行（当前 2 行，默认不勾）`。**默认不勾是设计判断**：手填成本是本单的商务判断，批量核对不该顺手把它冲掉 |
| 差异清单的排序 | 按变化幅度降序，**"取不到价"排最前**——那是需要人去处理的那一类，不是数字变化 |
| 取不到价的收尾 | 允许只写"能变的 5 条"，剩下的保持原样并在清单里留一行；**不整批回滚**（12 条里 1 条取不到就全不做，等于让用户手工重来） |
| 第 2 步 | 一个轻量 Toast 就够：`已写入 5 条，1 条取不到价没动。` + `查看` 链接。**不再弹第二个确认框** |
| 权限 | 仅 `admin`（`canOverridePrice`）。`member` 看不到入口，不解释 |

---

### C.5 人员库 `/staff` + 人员详情 `/staff/:id` + 嘉宾价 `/guests`

> 「嘉宾价」不是一个独立模块，是人员库的**预置筛选视图**（分类锁在「专业嘉宾」）。
> 它走独立路由 `/guests` 而不是 `/staff?category=guest`：同一 pathname 换 query
> 不会重挂载组件，筛选不会生效。
>
> **v1.7（0.1.11）起侧栏不再挂这个入口**：人员库本身就能按分类筛，两个入口并排只会让人
> 以为这是两个模块。路由保留——老书签、别人发过的地址打开还是这个预置视图，
> 侧栏高亮「人员库」。

**目标**：人员按"计价方式"和"来源"两个维度管理，档期是隐形刚需。

```
┌ 人员库 ────────────────────────────────────────────────────────────────────────────┐
│ [ 搜姓名 / 工种 / 手机号              /]  [类型 v] [计价 v] [档期 ●] [+ 新建人员]  │
│                                                                                    │
│ 分类：全部(126) · 主持司仪(14) · 演艺资源(22) · 影像团队(18) · 策划设计(11)        │
│       执行搭建(26) · 礼仪模特(19) · 专业嘉宾(9) · 支持人员(7)    ← 人员 8 类       │
│ 来源：全部 · 自有(11) · 外聘(115)   计价：按天 47 · 按场 31 · 按人天 28 · 其他 20  │
│                                                                                    │
│ ┌───┬──────────┬─────────┬──────────┬──────────────┬───────┬──────────┬──────────┐ │
│ │[ ]│姓名      │类型     │工种      │计价方式      │单价   │档期      │来源      │ │
│ ├───┼──────────┼─────────┼──────────┼──────────────┼───────┼──────────┼──────────┤ │
│ │[ ]│张启明    │外聘专家 │主持人    │按场 (4h)     │¥2,800 │9/28 已占 │星辉经纪  │ │
│ │[ ]│陈默      │自有管理 │项目经理  │按人天        │¥1,200 │空闲      │自有      │ │
│ │[ ]│李思雨    │外聘兼职 │礼仪      │按天 (8h)     │¥650   │9/28 已占 │星辉经纪  │ │
│ │   │          │1.7m 以上│          │              │       │9/29 空闲 │          │ │
│ │[ ]│王大力    │外聘兼职 │搭建工    │按天 (8h)     │¥480   │空闲      │熟人介绍  │ │
│ │[ ]│赵一鸣    │外聘专家 │摄影师    │按天 (双机位) │¥3,500 │9/27 已占 │独立      │ │
│ └───┴──────────┴─────────┴──────────┴──────────────┴───────┴──────────┴──────────┘ │
│ 已选 1 项  [攒进报价单]                                      共 41 条  < 1 2 3 >    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**人员详情 `/staff/:id`**（结构复用物料详情的"供应商行为行"模式，但字段换成档期）：

```
┌ 人员库 / 外聘专家 / 张启明                                        [编辑] [更多 ⋯]   ┐
│                                                                                    │
│  张启明                                      外聘专家 · 主持人                     │
│  按场计价（单场 4 小时，超时 ¥400/小时）      来源 星辉经纪 · 合作 11 次          │
│  最近报价 ¥2,800/场               近 90 天变化 ↓12.5%     [电话] [微信]            │
│                                                                                    │
├─ 各供应商/渠道报价 ────────────────────────────────────────────────────────────────┤
│  渠道          单价(¥/场)  超时费    备注                        更新       操作    │
│  星辉经纪       2,800     400/小时  长期合作，年会档期紧          09-26     ⋯      │
│  独立接单       3,200     500/小时  直接联系，可议价              07-02     ⋯      │
│  同行推荐-老周   3,000     —         需报销差旅                    03-11     ⋯      │
│                                                                                    │
├─ 档期（未来 30 天）────────────────────────┬─ 出勤记录 ─────────────────────────────┤
│  9月   27  28  29  30 │ 10月  1  2  3  4 … │  2026-09-28  年会《向新而行》  1 场    │
│        ●   ●   ○   ○  │       ○  ○  ●  ○   │  2026-08-15  客户答谢宴        1 场    │
│   ● 已占用  ○ 可预约   [打开日历视图]        │  2026-06-20  开业庆典          1 场    │
└────────────────────────────────────────────┴────────────────────────────────────────┘
```

- 计价方式列显示的是**每一行自己的 `unit_mode`**（`按天` / `按场` / `按人天` / `按小时` / `按半天`），不是这个人档案上的默认值。单价列必须显示计价单位，否则主持人 ¥2,800 会被误当成"一次"还是"一天"。
- 同一行里若这个人的默认计价（`items.pricing_mode`）与该条价的 `unit_mode` 不同，**不标任何异常**——按场报一次是正常的商务行为（TC-3B.8）。
- 上一版我列过 `按班` 和 `按项目`，已删：`按班` 在数据上与 `按天` 同形（都是"一个人一天多少钱"，只是叫法不同），并存会让同一批人分成两组、组内互相不能比，反而制造假缺口；`按项目` 无法比较，MVP 归到 `按场`。**枚举多一个值不是灵活性，是把可比性切碎。**
- 档期条：30 个 22px 方块，`●` = 已被某张报价单占用（从报价单反查），`○` = 空闲。点方块弹当日项目名 + 跳转报价单。

#### 人员备注（v1.14 新增）

与物料备注**是同一列**（`items.note`），只把标签从「物料备注」换成「人员备注」：`按人天报；夜班（22:00 后）按 1.5 倍`、`含彩排一次；跨市场地另计差旅`。这类话以前写在报价员的备注里、写在微信收藏里，出单时再抄一遍——抄漏一次就是一个要跟客户吵的夜晚。规则、搜索、不回写档案，全部同 C.3「物料备注」，不再重复一遍。

---

### C.6 供应商管理 `/vendors`

```
┌ 供应商 ──────────────────────────────────────────────────────────── [+ 新建供应商] ┐
│ [ 搜供应商名称 / 联系人 / 手机号]      [类型 v] [只看有欠款]                       │
│ 类型：全部(18) · 线上电商(7) · 线下定做厂(5) · 灯光音响商(3)                       │
│       经纪公司(2) · 自有(1)                                                        │
│                                                                                    │
│ ┌───┬───────────────┬──────────┬─────────┬───────┬───────┬────────────┬──────────┐ │
│ │[ ]│供应商         │类型      │结算方式 │账期   │报价数 │最后更新    │负责人    │ │
│ ├───┼───────────────┼──────────┼─────────┼───────┼───────┼────────────┼──────────┤ │
│ │[ ]│金桥桁架厂     │线下定做厂│月结     │30 天  │12 个  │今天 09:24  │王磊      │ │
│ │[ ]│星光灯光       │灯光音响商│按单结   │现结   │24 个  │今天 08:51  │陈默      │ │
│ │[ ]│淘宝-喷绘之家  │线上电商  │按单结   │现结   │9 个   │昨天 11:38  │陈默      │ │
│ │   │               │          │         │       │       │(!) 187 天  │          │ │
│ │[ ]│淘宝-演艺设备  │线上电商  │按单结   │现结   │17 个  │06-18       │王磊      │ │
│ │   │               │          │         │       │       │(!) 148 天  │          │ │
│ │[ ]│星辉经纪       │经纪公司  │月结     │15 天  │8 个   │09-26       │王磊      │ │
│ └───┴───────────────┴──────────┴─────────┴───────┴───────┴────────────┴──────────┘ │
│ 共 18 家                                                          < 1 >            │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**供应商类型：库里的枚举码 ↔ 界面上的中文（架构已定 5 值，界面不要另造）**

| 枚举码 | 界面文案 | 卡片徽章图标（Lucide） | 典型对象 |
|---|---|---|---|
| `online` | 线上电商 | `shopping-cart` | 淘宝店、1688 卖家 |
| `factory` | 线下定做厂 | `factory` | 喷绘厂、桁架厂、木作 |
| `rental` | 灯光音响商 | `speaker` | 灯光、音响、LED 屏租赁 |
| `freelancer` | 经纪公司 / 个人 | `user-round` | 星辉经纪、独立主持人、摄影 |
| `internal` | 自有 | `building-2` | 公司自己的搭建队、自有项目经理 |

- **界面上永远显示中文**，枚举码只出现在接口与筛选参数里。架构建议我改徽章枚举而不是改库，这个判断对——库里改一个值要动 PRD + 用例 + 架构三处，界面上只是五个字符串。
- **人员与物料共用同一张 `suppliers` 表**，`type` 不区分对象：一个人挂在经纪公司就是一条 `freelancer` 供应商，是自有员工就是 `internal`。所以「外聘 vs 自有」的成本对比，天然就是同一个人员主体下两条价格并列展示——**这正是产品想要的，不需要额外字段。**
- `freelancer` 的界面文案按对象变：物料侧显示 `经纪公司`，人员侧显示 `个人 / 经纪`。这是因为「人挂在经纪公司」和「自己接单」对报价员的意义一样，都是一个外部供给源。

供应商详情页用抽屉（Drawer，480px）而非整页，因为它的信息量不足以撑满一页，且常从比价区就地查看。抽屉内含：基本信息 / 该供应商全部报价（小表格：物料·单价·更新·[改价]）/ 关联报价单数 / 备注。

#### 开票信息五项（v1.13 新增）

编辑抽屉里，`店铺链接` 之后、`备注` 之前，独立一块：

| 字段 | 提示文案 | 校验 |
|---|---|---|
| 纳税人识别号 | 统一社会信用代码就是它，18 位。从营业执照或开票资料里粘，别手抄 | 15–20 位字母数字，自动转大写、去空格与横杠 |
| 公司地址 | — | ≤200 字 |
| 联系电话 | 发票上印的那个号，通常不是上面「电话」那个联系人手机 | 至少 7 位数字，允许 `+ - 空格 括号` |
| 开户银行 | — | ≤100 字 |
| 银行账号 | 空格和「-」存的时候会自动去掉，抄的时候不用管格式 | 6–32 位数字，自动去空格与横杠 |

- **五个全是可选**：没有红星，全空能保存，标题旁写着 `（可选）· 已填 3/5`。客户的原话是"可选字段"，把加字段做成加门槛是最容易犯的错。
- **校验逐格进行，离开输入框才报**：边打字边报红等于一直骂用户。保存时若有错，错误落在各自格子上，底部只说一句「有 N 处要改」——不把用户滚回顶部去找一句总错。
- **`联系电话` 不是 `contact_phone`**：前者是税务局认的号，后者是找到这个人的手机。合成一列，迟早有人把私人手机号开进发票。
- **不校验税号校验位**：算错一次，正确的新税号会被判非法，人就会被迫瞎填一个能过的 —— 那时错的比现在多。
- 工本费为零：`PATCH /suppliers/:id` 早就存在，这里只是把五列加上去；**新建供应商弹窗不加这五项**（快速建档只要名字和类型），要填去编辑抽屉。
- 详情抽屉里五项**填了才显示这一块**：全 `—` 的表会让人以为坏了。
- **这五格用 `.num-code` 而不是 `.num`**：`.num` 是表格金额列的规矩（右对齐 + 不换行）。套在输入框上，18 位税号会被推到框子最右边，和上面左对齐的「公司地址」错开一列，看着像两个版本的界面拼在一起。`.num-code` 只借等宽字形让它逐位可数，对齐跟随容器。
- **报错时提示语让位**：一行灰提示 + 一行红错误并排出现，人只会读短的那行，而"15–20 位"正是他此刻需要的。出错即收起 hint、输入框边框转红（`aria-invalid`），错误写在该格下方。

---

### C.7 报价单编辑器 `/quotes/:id/edit` [核心]核心页 **【出稿优先级 2】**

> PRD §7.3 + §11.3 + 01a TC-12：① 成本价字段级权限——**任何导出通道不得输出成本列，客户版由服务端独立 DTO 渲染时剥离**；② 每行可标记「不在客户版显示」（导出时整行剔除）；③ **两条独立导出路径**（客户版 / 内部版），内部版**仅 admin** 可导出；④ 出单时若无有效价或价已过期，**必须红色强提示 + 允许手填成本，绝不静默用旧价**（`has_overdue_price` 验收线 = 0）。

```
┌ ← BJ-2614 · 星海科技 2026 年会《向新而行》      草稿已存 09:41   [预览客户版] [导出 v] ┐
│  ↑ 导出菜单里「导出内部版（含成本）」对 member 置灰，见 §C.7 导出权限                  │
│ 客户 星海科技 · 活动日 2026-01-18 · 场地 杭州国际会议中心 3F                           │
│ 口径 [含税|不含税] · 毛利率 40%(≈成本 × 1.667) [改]   ↑ 口径是真开关，不是注释         │
├──────────────┬──────────────────────────────────────────────────────────────────────────┤
│ 选品抽屉 320 │  明细                                                        [精简|完整]│
│              │  ┌──────────────────────────────────────────────────────────────────────┐│
│ [ 搜物料 / 人员  /]│ │   # 名称              规格        单位  数量  成本单价  成本小计   ││
│              │  ├──────────────────────────────────────────────────────────────────────┤│
│ [物料][人员]  │ │ > 一、舞美硬体 ───────────────────────────── 成本 ¥46,320  对客 ¥79,200││
│ 嘉宾价 (常用) │ │ [ ]1 背景板 6×3m 桁架喷绘  550高精   ㎡    18   28.00    504.00    ││
│              │ │ [ ]2 桁架 3m 方管        3000×3000 根/天 16   45.00    720.00    ││
│ 常用 v        │ │ [ ]3 舞台地毯            灰色加厚   ㎡    36   15.00    540.00    ││
│  背景板 6×3m  │ │ [ ]4 LED 屏 P3.91        500×500箱  ㎡/天 24  380.00  9,120.00    ││
│  桁架 3m 方管 │ │                                                                        ││
│  LED P3.91   │ │ > 二、主持与串场 ─────────────────────────── 成本 ¥2,800  对客 ¥4,800  ││
│  主持人       │ │ [ ]5 张启明（主持人）    单场4小时  场    1  2,800.00  2,800.00    ││
│              │ │                                                                        ││
│ 分类 v        │ │ > 三、影像团队 ────────────────────────────── 成本 ¥3,500  对客 ¥6,000  ││
│  舞美硬体 41  │ │ [ ]6 赵一鸣（摄影双机位）8小时/天   天    1  3,500.00  3,500.00    ││
│  灯光音响AV56 │ │                                                                        ││
│  印刷物料 38  │ │ > 四、专业嘉宾 ────────────────────────────── 成本 ¥0    对客 ¥0  (!)  ││
│  桌椅布草 24  │ │ [ ]7 李工（行业讲师）    半日  (!)  无有效价  场    1  [手填成本]  0.00  ││
│  美陈软装 29  │ │                                                                        ││
│  礼品物料 31  │ │ ＋ 添加行      ＋ 从上次年会方案复制      已隐藏客户版 1 行              ││
│ ─────────    │ └──────────────────────────────────────────────────────────────────────┘│
│ 已勾选 0 项   │                                                                        │
│ [攒进报价单↓] │                                                                        │
├──────────────┴──────────────────────────────────────────────────────────────────────────┤
│ 7 项  成本 ¥52,620.00   对客 ¥90,000.00   毛利 ¥37,380.00   毛利率 41.5%   (!) 1 行缺价 │
│                                                    ↑ 22px 590         [生成报价单] 禁用  │
│  ↑ 禁用只因还有 1 行没填成本；填完立刻可用，不用刷新、不用重存                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 攒单：对客价从哪来（v1.4 修正，现场反馈后补的）

**症状**：勾了物料点「攒进报价单」，右下角绿字「已把 2 项攒进报价单」，右侧明细还是空的，勾选也没了。

**真因**：对客价不是取来的，是**成本按单头目标毛利率反推**的（`sale = cost / (1 - rate)`）。
新建的草稿单没有毛利率，服务端整批 `40001 无法反推` 拒绝；而按钮的提示语在**请求发出之前**就弹了。

| 规则 | 具体 |
|---|---|
| 毛利率必须在攒单的地方 | 选品抽屉底部一行：`已勾选 N 项` ＋ `毛利率 [ 40 ] %`。填的值随这次攒单落到单头（只影响反推，不改已有行） |
| 成功提示只能等结果 | `await` 到 `added > 0` 才清勾选、才说「已攒进 N 项」。失败时**勾选原样留着**，原因写在按钮上方（toast 会飘走，原因要留在原地） |
| 一项都没进去 ≠ 部分进去 | 部分进单说「攒了 N 行，M 项没进去：原因」；全部失败只报原因，不报数字 |
| 改毛利率不改变已有行 | 单头毛利率旁有 `按毛利率重算`：把已有行按新毛利率整体重算；有手改过对客价的行**先弹确认**再覆盖 |

> 这条修正的教训不是"少写一行 toast"，而是**提示语本身也是数据**：它说"成功"，用户就相信列表里已经有东西了，于是不会再去核对——比不提示更糟。

#### 攒单：用哪家（v1.9 补，现场反馈"勾了物料选不了供应商"）

**症状**：勾完物料，价格库把"同性质同口径里最便宜的那家"自动填上；想换成别家（那家做不出来 / 交不了期 / 上次惹过客户）——**没有地方选**。只能先攒进去、再回到行上点一次成本格、在弹窗里换，勾五项就来回五趟。

**真因**：`/price-lookup` 从 0.1.0 就有 `supplier_id` 参数，**界面从来没传过它**。这条能力一直在，只是没有入口——和"供应商档案改不了""成员权限改不了"是同一类：后端通了，界面没接。

| 情形 | 勾中的卡片里长出一行 | 为什么 |
|---|---|---|
| 一条价都没录 | 灰字`还没录价，进单后手填成本` | 给一个空下拉让人点是假的可选 |
| 只有一家、一种性质 | 文字`金桥桁架厂 ¥520.00/人天` | 下拉里只有一项是假的选择 |
| 同一性质多家 | 下拉，首项`自动（睿视 AV 租赁 ¥2,200.00/天）`＋各家价 | 默认仍是价格库的规则（不改变既有行为），改了就按改的取 |
| 多种性质（租赁 / 买断） | 下拉首项`选一种（共 2 种性质）`，**红框**，不给默认值 | 买还是租是商务判断，猜错会被当成真的写进客户版 |

- 选择只是 `supplier_id` ＋ `pricingNature` 两个值：**交易性质和供应商必须一起定**，分两次问会拼出" A 家的价 + B 家的性质"这种价格库里不存在的组合。
- 换过搜索词以后，之前勾的卡片已经不在列表里——底部 `已勾选 N 项 · 看用谁` 点开是总览，每项都能改（默认收起，这栏只有 480px）。
- 参考最低价取**同性质**那一组的：选了买断却拿租赁的最低价当参照，行上那句「比最低高 ¥120」就是错的。

> 顺手改掉的两处：
> ① 分类从纵向列表改成**横排一行**——8 个分类吃掉 250px，320px 宽的选品栏只剩 90px 给物料，一屏一张卡片；
> ② 明细表的**成本单价列不再随密度收起**（精简档原来把它藏了，而那正是换供应商的唯一入口），阈值同时从 1366 提到 1520：1440 的屏扣掉侧栏与选品栏只剩 848px，完整档 1104px 一摆就横滚，把"毛利率 / 操作"推出视口。

#### v1.1 相对上一版的 5 处修正

| # | 上一版 | v1.1（按 PRD） | 原因 |
|---|---|---|---|
| 1 | 「报价单价 / 报价合计」 | **「对客价 / 对客合计」** | 与 PRD `sale_unit_price` / `total_price` 术语一致；"报价"在口语里既指供应商报价也指我们卖价，必须区分 |
| 2 | 无「不在客户版显示」 | **每行 `eye-off` 开关**，开启后整行降级（灰字 + 虚线底 + 左侧竖细线） | 赠送项、内部核算行必须能被藏起来 |
| 3 | 单一导出 | **两条独立导出路径**：`导出客户版`（服务端独立 DTO 渲染）/ `导出内部版`（含成本毛利，**仅 admin**） | PRD §7.3 + TC-12.6/12.7 |
| 4 | 缺价只是提示 | **红色阻断**：缺价行红底、成本单价格变「手填成本」输入框、「生成报价单」按钮 disabled | `has_overdue_price = 0` 是验收线 |
| 5 | 成本单价只读 | 成本单价格可点开 Popover **换供应商**，并标注「比最低价高 ¥3.00」 | PRD R3：实际可能定了别家，毛利要按真实成本算 |

#### 缺价 / 过期价的错误态（全产品最不能出错的地方）

**核心原则：过期价可以"看见"，但绝不可以"被静默使用"。**

> 注意 · **v1.2 关键修正（PM 标红的那条红线）**：上一版我写的「缺价 → 生成报价单 disabled」有一个会让产品**第一天就死**的歧义。
> **正确逻辑：阻断的对象是"这一行还没有任何成本数"，不是"这个物料没有价格库记录"。**
> 新库上线第一天，大量主体必然还没录价。如果"库里没价 → 按钮永久 disabled"，用户勾 8 行、4 行没价 → 出不了单 → 回 Excel → 产品死。
> **所以：只要每个缺价行都拿到了一个成本数（手填一个、或按旧价重建一个），按钮立刻变可用——不刷新页面、不重新保存。**

| 情形 | 触发 | 行内表现 | 全局表现 | 允许出单？ |
|---|---|---|---|---|
| **A. 该主体无任何价格记录** | `price_match_failed: no_price` | 成本单价列变成 `[手填成本]` 输入框（红描边），行底 `--danger-subtle`，行首 `circle-alert` 16px | 汇总条红：`1 行还没有成本，填上就能出单`；「生成报价单」disabled，hover 出 tooltip `还差 1 行没填成本` | **填完即允许**（同一秒按钮转可用） |
| **B. 全部价格已过有效期** | `price_match_failed: all_expired` | 同 A，但多一行 11px 红字 `最后一版价 2025-03-11 已失效 ¥3,200`；输入框下方给两个出路：`[手填成本]` + **`按旧价重新录价`**（见下） | 同 A | **填完即允许** |
| **C. 用着陈旧价**（未失效但超阈值未核价） | — | 成本单价旁琥珀 `(!) 187 天`，可点 `去更新` | 汇总条琥珀一行：`2 行用的是 90 天前的价，确认无误可出单` | **允许，不阻断** |
| **D. 手填的成本** | `cost_source = manual` | 输入框右侧 `手填` 灰徽章；行 hover `手填成本，不来自价格库` | 汇总条灰字 `1 行手填` | 允许 |
| **E. 负毛利** | 毛利 < 0 | 该行毛利数字转 `--danger` + `circle-alert` | 汇总条红底 + `这单是亏的（-4.2%，差 ¥3,780）` | **允许，不阻断** —— 只进自检清单（§发送前自检） |

**阻断只有一条规则，写成一行伪代码（前端照抄）**

```ts
disabled = lines.some(l => l.cost_unit_price == null || l.cost_unit_price <= 0)
// 就这一条。不看 cost_source，不看是否软陈旧，不看毛利正负，不看供应商是不是最低价。
```

- **负毛利绝不阻断。** 有些单是故意亏的——走量、拿案例、维护关系、给大客户做敲门砖。阻断会逼用户绕过系统（去 Excel 出单），那比亏钱更糟。它只进自检确认清单：`这单是亏的，确认出？`
- **软陈旧绝不阻断。** 拦它等于逼人每周点 30 次"确认"，三天后就闭眼点。
- **"供应商不是最低价"绝不阻断。** 报价员可能知道那家便宜的做不出来、交不了期、或者上次惹过客户。我们只提示，不替他决策。

**为什么 C 与 D 允许、A 与 B 拦**：
A/B 是"公司里没有这个价"，此时用任何价格都是拍脑袋——必须逼人当场填一个已知成本。
C 是"有价但可能老了"，这是日常，阻断会让人放弃系统；琥珀提示 + 内部版留痕即可。
**D 手填成本不污染 `has_overdue_price`**——它记的是 `cost_source = manual`，与"引用了失效价"是两件事，所以验收线仍然是 0。（详见 §E.7 指标口径）

**手填成本输入框的交互细节**
- 点击即获得焦点，占位符显示灰色旧价 `原价 ¥3,200（已失效）`——**看得见历史，但不能一键采用**，必须自己敲。这是刻意的不方便，也是整套设计里我最坚持的一处。
- `Esc` 取消手填，回到红态。
- 手填值必须 > 0，否则 `输入框抖动 80ms` + `填一个成本，哪怕估的`。
- 填完后该行立刻转为正常态（红底消失、徽章变 `手填`），汇总条那行的 `1 行还没有成本` 当场减为 0。

#### 「按旧价重新录价」按钮（v1.2 新增，PM 指名要的那条出路）

> **问题**：手填很烦。用户嫌烦就会整单回 Excel 出——那这条"刻意的不方便"就变成了"把用户赶走"。
> **PM 的解法**：给一个显式动作，把"用旧价"这件事**变成一条新价格记录**。区别是本质的——
> **不是「静默沿用旧价」，而是「确认这仍是当前价，并把它写回价格库」。**

| 项 | 规范 |
|---|---|
| 出现位置 | 只有 B 情形（全部已失效）出现。A 情形（从来没有过价）**不给这个按钮**——没有旧价可"重建"，那是真的没询过价 |
| 位置 | 缺价行右侧，手填输入框下方 4px，11px 文字按钮，`--link-fg` 带下划线 |
| 文案 | **`按旧价重新录价`**（不是「沿用旧价」——"沿用"听起来像"就用那个旧的"，"重新录价"听起来像"建一条新的"，后者才是事实） |
| 点击后 | ① 服务端创建一条新 `PriceBook`：`effective_from = 今天`、`unit_price = 旧价`、供应商/性质/单位/含税口径全部沿用；② 旧价自动 `superseded`；③ 本行 `cost_source = price_book` 指向新记录、`reference_lowest_price` 取当时最低有效价；④ 行下方出现 12px 灰字 `已按 2025-03-11 的 ¥3,200 重建为今天生效的新价（旧价已结束）· 撤销` |
| 可撤销 | 10 秒内点 `撤销` → 删除新记录 + 旧记录恢复有效 + 本行退回缺价态。Toast 消失后仍可用 `⌘Z` |
| 权限（v1.7 按 R15 = 分层开放改写） | **`admin` / `member` 都可以**。理由：它建的是**一条新记录**、旧价是按版本规则自然结束，不是"覆盖别人录的价"——和「新建一条价」是同一个机制的两个入口。真正只给 admin 的是**原地改价、停用、改交易性质与折算系数**。 |
| 副作用提示 | 点击后 Toast 补一句：`这条价已经进了价格库，下次比价就能用上。` —— 这是把"报价动作"转成"维护动作"的那句话，成本几乎为零，但它是整个产品最想要的行为改变 |
| 埋点 | `price_recreated_from_old`（带 `days_stale`、`old_price`） |

**手填 vs 按旧价重新录价，一句话分清（界面上也要这么写）**

| | 手填成本 | 按旧价重新录价 |
|---|---|---|
| 影响范围 | **只影响这一张单** | **修正价格库**，后续所有单都能用 |
| 数据状态 | `cost_source = manual`，永久留痕 | `cost_source = price_book`，成为正式价格 |
| 什么时候用 | 我知道现在的价，但懒得录 | 我确认这个旧价还是当前价，只是没人更新过 |
| 代价 | 手工敲一个数 | 多一次点击，且价格库里多一条记录（这是好事） |

#### 「新建一条价」= member 唯一的"改价"路径（v1.7 新增，R15 定案为分层开放）

> **客户选了 (c)：member 能新建价格，不能覆盖 / 停用已有价格，不能改交易性质与折算系数。**
> 于是 member 想"把 ¥48 改成 ¥45"时，**唯一路径是新建一条版本**。这是设计上最容易做错的一处：如果这个动作叫「改价」，member 会以为历史被覆盖了；如果它长得像编辑表单，他会顺手把别人录的价改掉。

| 项 | 规范 |
|---|---|
| **动作名字** | **`新建一条价`**（不是「改价」、不是「编辑」、不是「修改」）。**名字决定心智**：他以为自己在"录一条新价"，就不会怀疑"历史被覆盖了" |
| 入口 | 价格行 hover 的操作区 + 比价卡片右上菜单。`admin` 与 `member` **看到的是同一个入口**（差别只在 admin 多一个「编辑」） |
| `admin` 的额外入口 | admin 价格行上同时有 `编辑`（原地改，就地生效，无版本）与 `新建一条价`。**两个动作在视觉上必须分开**，不能合并成一个"改价"再在弹窗里选模式 |
| `member` 看到的 | 只有 `新建一条价`。**「编辑」「停用」不渲染**（不是置灰——置灰会让他去点，点了再被拒是两次挫折）。但按钮**位置上留一行 11px 灰字**：`改已有的价要管理员做，你可以录一条新的` |
| 打开后的表单 | 供应商 / 单位 / 交易性质 / 折算系数 **全部预填上一条的值且只读**（灰底 + `lock` 16px），**只让改两个字段：单价、生效日** |
| 为什么只放开两个 | 这三个锁定项正好就是"会让分组与比价结论变化"的字段。放开了，他等于换个壳改性质，把 §C.4 那个事故从后门放回来 |
| 保存后 | 上一条自动 `superseded`（`effective_to = 新价生效日 - 1 天`），新记录 `created_by = 他`。**不做 10 秒撤销**——这不是替换，是新增一条历史；要改回来就再新建一条 |
| Toast | `已新增一条价：¥45.00，从 今天 起生效。旧价（¥48.00）在昨天结束。` —— **把"旧价结束"写出来**，否则他还是会以为旧价被抹掉了 |
| 与「复制为新价」的关系 | 同一件事的两个入口名：比价卡片菜单里叫 `复制为新价`（看清是哪一条），价格行里叫 `新建一条价`（没有上下文）。**文案两张表，判定一处** |
| **权限判定是两个函数，不是一个按钮的两种状态**（架构 ①） | `canCreatePrice(role)` —— 管 `POST /prices`，member 放行；`canOverridePrice(role)` —— 管 `PATCH /prices/:id`、`archive`、`refresh-prices`、删主体、删供应商，**仅 admin**。所以「新建一条价」的可用性取前者，「编辑 / 停用 / 归档」的禁用逻辑取后者，**各取各的，禁止合并成一个 `canEditPrice` 再在里面分支**——合并之后就会出现"member 点新建被连带禁用"这种反向 bug |
| 埋点 | `price_created_versioned`（带 `from_price_id`、`changed_fields`，应当恒为 `['unit_price','effective_from']`） |


#### 明细表列定义（视觉 13 列，完整档承载 15 个数据点）

| 列 | 宽 | 对齐 | 精简档 | 完整档 | 说明 |
|---|---|---|---|---|---|
| 勾选 | 36 | 中 | 有 | 有 | 多选 → 批量删除 / 批量改毛利率 / 批量隐藏 |
| 序号 | 36 | 右 | 有 | 有 | 拖拽手柄 `grip-vertical` hover 显示 |
| 名称 | flex 200 | 左 | 有 | 有 | 单击进编辑；第二行 11px 灰字显示 **采用的供应商**（`supplier_id`） |
| 规格/备注 | 120 | 左 | — | 有 | 第一行规格（单行截断 + tooltip），下面接**行备注**（两行封顶、可点开就地改，见下「行备注」）。精简档没有这一列，备注落到名称格的第三行。**编辑页是一格两行，客户版是两列**（v1.16）：录入时两段信息在同一个视野里更好改，出稿时拆开更好读——两处不要求长得一样，只要求读的是同一个 `quote_items` 字段 |
| 单位 | 52 | 左 | 有 | 有 | 来自主体，不可改（人员显示计价方式） |
| 数量 | 60 | 右 | 有 | 有 | 数字输入 |
| 成本单价 | 84 | 右 | — | 有 | 只读，可点换供应商；缺价时变输入框。**单元格内出现 `手填` 徽章即 `cost_source = manual`**，不另设"来源"列（省 56px） |
| 成本小计 | 92 | 右 | 有 | 有 | 计算列，`--fg-3`，只读 |
| **对客价** | 88 | 右 | 有 | 有 | **可编辑**，默认由整单毛利率算出（口径见下节） |
| **对客小计** | 96 | 右 | 有 | 有 | 计算列，`--fw-medium` |
| 毛利率 | 64 | 右 | 有 | 有 | `41.5%`；**行级只显示数值，不设阈值着色**（见下「毛利率口径」） |
| 供应商 | 104 | 左 | — | 有 | **一格两行**：第一行供应商名（`supplier_id`）；第二行 11px **`最低 ¥25.00`（`reference_lowest_price` 快照）+ 那家是谁（`reference_lowest_supplier_id` 反查名）**。成本高于快照时第二行转 `--danger` 并显示 `高 ¥3.00`，hover `录这单时最低是 ¥25.00（金桥桁架厂），你用了 ¥28.00`。<br>`reference_lowest_supplier_id` 是架构补的：有了它才能说清「本可选 3 家、你选了第 2 家」，只存一个价格数字是答不了这句话的 |
| 操作 | 72 | 中 | 有 | 有 | `eye-off` 隐藏客户版 / `copy` / `trash-2` |

**为什么 `supplier_id` 和 `reference_lowest_price` 做成"一格两行"而不是"两列"——这是我对 PM 那条要求的一处偏离，理由必须写清**

PM 要的是**两个值都要记**，这一点我完全同意，而且必须在数据库里分开存：三个月后最低价变了，没有快照就无法回答老板"这单为什么贵了"，自检第 3 条（成本高于最低价）事后也就成了一笔糊涂账。

但**视觉上多一列是错的**。1366 是最低验收宽（内容区 1102px），我算过三种方案：

| 方案 | 1366 下总宽 | 结果 |
|---|---|---|
| 13 列（现状） | **1104px** | 刚好，无横滚 |
| 14 列（多一列 88px） | 1192px | **出现横向滚动条 → 直接违反 PRD §11.4 的 P0 硬线** |
| 砍别处腾 88px（规格 120→96、名称 200→176…） | 1116px | 仍超标，且"规格"和"名称"被砍到不可读 |

所以：**两个值都在，只是放在同一格的两行里。** 而且这个位置比单独一列更好——"比最低贵 ¥3"这个结论离开供应商名就没有意义，挨着放才读得懂。**信息一个没少，横向像素一个没多。**

- **精简档默认**：1280–1365 屏自动切精简（9 列），≥1366 默认完整（13 列 / 15 个数据点），用户可手动切。
- **快照语义（TC-11，界面必须照此说话）**：明细行上的 `名称 / 规格 / 单位 / 供应商名 / 成本单价 / 对客价 / 数量` 全部是**下单那一刻的快照**。所以：
  - 之后改了物料名、供应商改名、价格调升——**这张已发出的单子不许跟着变**，重开看到的是当时的值。
  - 因此行上不显示"这个价现在变了"之类的实时对比；要看现状去比价页。**单据是历史，比价页是现在，两者不能混在一张表里说话。**
  - 草稿态（`draft`）才实时取最新价——因为草稿还没成为对外承诺。
- 分组行（`> 一、舞美硬体`）：高 32px、底 `--surface-sunken`、右侧显示该组 `成本 / 对客` 两个小计。展开/折叠单个组。

#### 行备注：只对这张单有效（v1.14 新增）

客户原话：「报价单明细显示备注，该备注可以编辑，编辑后的内容只对这张报价单有效。」

这一条最容易做错的地方不是界面，是**数据归属**。行备注的真相只有一处——`quote_items.note`（那张单的那一行）。物料档案上的 `items.note` 只在**加行那一刻**当一次初值。

```
加行 → note = 物料备注  ─┐
                          ├→ 之后两边各自独立，谁改都不影响谁
单里改 → 只写 quote_items.note
物料档案改 → 只影响以后新加的行，已发出的单一个字都不变
```

- **点开即改，不弹抽屉**。备注是一句话，为它开个抽屉、填完再点保存，人就不改了。单击变输入框，`Enter` 提交、`Esc` 还原，空着显示 `＋ 备注`（`--fg-meta`），hover 虚线。
- **两行封顶**（`-webkit-line-clamp: 2`，11px / 1.35 行高）。一行只露 6 个字等于没显示，无限高又把整张表撑成三行——留两行，看全看细都去 hover（title 里是全文 + `点这里改，只影响这张单`）。
- **清空是清空**。删空提交必须写成 `null`，不能被"物料备注"在下次保存时填回来。这类"清了又回来"的字段会让用户彻底不信这个系统，比没有这个功能糟得多——服务端判定用 `!== undefined`（不传 = 不动，传空 = 清空），不是 `??`。
- **`issued` 之后只读**。已发出的单是对外承诺，行备注也在承诺范围内；要改就复制重报（v2）。
- 打印/导出走的是同一个字段，但**客户版是独立一列**（v1.16）：详细档的列是 `项目 | 规格 | 单位 | 数量 | 单价 | 小计 | 备注`——备注排在**小计之后、整表最后一列**（v1.17 从小计前挪过来）：它是不定长的一段话，只有挨着纸边才有地方向下折行；夹在中间时一条长备注会把金额列挤成两行，而金额是客户唯一必须一眼读准的东西。规格说"这个东西多大"，备注说"报价时要记得的事"，两者并排而不是挤在一格。精简档省掉这两列时，备注折进项目名后面的括号（`桁架背景板（含运输，不含电费）`）——省列不能把信息一起省掉。
- **备注折行只在自己列里发生**（v1.17）：`.paper-tbl` 用 `table-layout: fixed` + 列宽百分比（百分比由 Excel 字符宽换算，两边比例天然一致），文字列 `overflow-wrap: break-word`、数字列 `nowrap`。实测 A4 内容宽 186mm（703px）下 `scrollWidth === clientWidth === 703`，长备注折 6 行也只把行高撑起来，不横向溢出；Excel 侧对应的属性是 `alignment.wrapText`，同一个 `SheetColumn.wrap` 驱动，不各写一套。

#### 报价人：抬头印谁的电话（v1.14 新增）

客户原话：「报价单抬头显示操作人员的名称和电话。」

- **印的是"做这张单的人"，不是公司客服电话**。客户拿着报价单要问的是"我这个单子你算的这行是什么意思"，接电话的应该是那个算账的人。所以取值链是 `quotes.created_by → users.name / users.phone`，全程不读公司档案。
- **位置**：抬头信息块的最后一行，`报价人：王磊` 左格 + `联系电话：0571-8888 6677` 右格，与「活动日期 / 税口径」同一套 11.5px 排版，不新造样式。
- **姓名与电话各自独立**：只填了姓名 → 只印 `报价人：王磊`；两样都没有 → **整行不出现**（不印空标签，客户版上不能有 `联系电话：` 后面一个破折号）。
- **数据来自登录账号，不在报价单上另存一份快照**。这是有意为之的例外：报价单上别的字段都是下单那一刻的快照，但"谁做的这单、怎么找他"必须跟着账号走——他换了号，客户打旧号打不通才是更坏的结果。
- 编辑页单头也显示同一行（只读），电话没填时写 `（账号没填电话，抬头不显示）`——这句话是给人看的下一步，不是错误提示。


#### 毛利率口径（定价的唯一算法）

- 顶栏显示整单 **`毛利率 40%`**（可改，改后**所有未被手改的行**重算对客价）。**标题写"毛利率"，不写"加价率"**——见下面那条陷阱。
- 单行对客价被手改后：该行毛利率单独显示，**不再跟随整单率**，行尾出现 11px 灰徽章 `手改`，hover `恢复按整单毛利率计算`。
- **行业陷阱，必须「常驻」而不是藏在弹层里（PRD v1.4 修正了我的做法）**：报价员说的「这个加 40 个点」指**成本加价**（成本 ×1.4 → 真实毛利率只有 28.6%），而系统里存的是**毛利率**（对客价 = 成本 ÷0.6 = 成本 ×1.667）。**两者差 11.4 个百分点，一张 10 万的单差一万多。**
  上一版我把这段解释放进 popover，PRD v1.4 打回了，理由很硬：**会造成错误的那一瞬间，就是他输入数字的那一瞬间；藏在弹层里的解释等于没有。** 改成两层：

  | 层级 | 位置 | 文案 |
  |---|---|---|
  | **常驻**（一直在） | 单头信息区，紧跟 `毛利率 40%` 后面，11px `--fg-3` | `(≈成本 × 1.667)` —— 一行就够，它让「毛利率」和「我该收多少」当场对上 |
  | **输入时**（改的那一刻） | 输入框下方两行 11px 灰字 | 第一行 `毛利率 40% → 对客价 = 成本 × 1.667`<br>第二行 `若你指的是「成本加 40 个点」，那对应毛利率 28.6% —— 这里填的是毛利率` |

  MVP **不做「毛利率 / 加价率」双模式切换**（PRD §6.6.5 明确）：一张单上只能有一个口径，两个数同时摆在页面上反而会让老板看错。
- 毛利率算法（写死，与 PRD §6.6.5 一致）：`毛利率 = (对客价 − 成本价) / 对客价`，即若毛利 40% → `对客价 = 成本 / 0.6`。
- **对客合计 = 0 时，毛利率显示 `—`，不显示 `0%`，也不许抛除零异常**（TC-7.10）。`0%` 会被读成"一分不赚"，`—` 才是"这个数不成立"。空单、全赠送单都会碰到这个分支。
- **系统内一律不出现「加成率」（毛利/成本）**，避免两个数打架（PRD §6.6.5 明确）。
- 底部汇总条：`N 项 / 成本合计 / 对客合计 / 毛利 / 毛利率`，毛利率 22px 590。

**毛利率的着色规则（v1.2 修正，PRD §11.5）**

| 情形 | 颜色 | 表现 |
|---|---|---|
| 毛利率 ≥ 阈值（**按本单「项目类型」取值**，未选类型回退全局 **25%**） | `--fg` 正常 | 无额外提示 |
| 0 ≤ 毛利率 < 阈值 | **琥珀** `--warning` + `triangle-alert` | 汇总条底转 `--warning-subtle`，文案要**说出阈值来源**（架构 ⑤ 的 `warn_rate_used` + `warn_rate_source`）：<br>`warn_rate_source = project_type` → `整单毛利率 18.4%，低于「品牌发布会」的 22%`<br>`warn_rate_source = global_default` → `整单毛利率 18.4%，低于默认的 25%`<br>**不阻断出单** |
| 毛利率 < 0 | **红** `--danger` + `circle-alert` | 汇总条底转 `--danger-subtle`，文案 `这单是亏的（-4.2%，差 ¥3,780）。确认要出？`；出单时进自检清单 |

> **为什么阈值用琥珀而不是红**：红色用多了就不红了。如果 25% 一破就标红，一周下来天天见红，用户对红完全脱敏，真正致命的负毛利反而看不见。**红只留给"这单在亏钱"和"这价格已失效"两件事。**

**「项目类型」下拉（v1.7 新增，客户 Q3：毛利红线按项目类型分）**

```
┌ ← BJ-2614 · 星海科技 2026 年会《向新而行》     草稿 09:41   [预览客户版] [导出 v]  ┐
│ 客户 星海科技 · 活动日 2026-01-18 · 场地 杭州国际会议中心 3F                       │
│ 类型 [ 品牌发布会 v ]  口径 [ 含税 ][ 不含税 ] · 毛利率 40%(≈成本 ×1.667) [改]     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| 项 | 规范 |
|---|---|
| 控件 | 单选下拉，36px 高，**放在单头信息区第 2 行最左**（在 `口径` 之前——因为它决定阈值，阈值决定着色的含义） |
| 选项（5 值，客户口径） | `年会 / 庆典` · `品牌发布会` · `展台特装` · `路演 / 地推` · `长期框架客户` |
| 空值 | **允许不选**，回退全局默认（设置项 `default_margin_threshold`，出厂 25%）。占位文案 `未选（按默认 25%）`，且这个百分比是**读设置动态渲染**的，不写死。**回退必须真的写进 `target_margin_rate`**（v1.16）——只写在占位里而落库 NULL，等于界面承诺了一个不存在的值：加行反推不出对客价、点「按毛利率重算」直接报「这张单没有目标毛利率」 |
| 阈值来源 | `app_settings.margin_warn_threshold_by_type`（JSON），每个类型一个数；**不硬编码在界面** |
| **只改颜色与自检提示** | 阈值变化**不许**让汇总条置灰、**不许**禁用出单按钮、**不许**把负毛利以外的数字变红。这条 v1.7 已经钉过，新逻辑不得破 |
| 换类型时的反馈 | 汇总条颜色与那句话 150ms 过渡更新；**不弹确认**（它只影响提示，不影响任何数字） |
| **必须显示阈值来源** | 汇总条那句话后面挂一个 11px 灰字来源标注：`按项目类型` / `默认`。接口给 `warn_rate_used`（实际用的数）+ `warn_rate_source`（`project_type` / `global_default`），界面**不许自己推断**——推断就需要把 5 个类型的配置值在前端再算一遍，而那份配置改了以后只有一个真相源。 |
| 为什么非要标来源 | 管理员在设置页改了「品牌发布会 22%」，回到单子发现还是 25%，如果界面不写来源，他只会以为设置没生效，再去改一遍——而那个类型本来就没填、走的是默认。**"我改了半天不知道改的是哪一层"是这类分级配置最常见的抱怨，解法不是加说明文档，是把来源标在数字旁边。** |
| 客户版 | **完全不出现**——项目类型是内部管理维度，客户版只有「活动名称」 |
| 埋点 | `quote_project_type_changed`（带 `from` / `to` / `old_threshold` / `new_threshold`） |

> **为什么是下拉而不是打标签**：这个值只有 5 个、且直接映射到一个数字。做成自由标签，运维就得维护一张"标签 → 阈值"的对照表，而那张表客户不会填。**枚举值少的时候，下拉永远比标签对。**

>
> **行级不设阈值，只显示数值。** 每行加价策略天然不同（有的物料走量只加 5%，有的人员要留议价空间加 80%），行级告警会天天误报。真正该预警的是整单。
>
> 阈值 25% 是 PM 的估计值不是客户事实，已挂 R11。**所有阈值都是设置项，不许硬编码**（清单见 §C.9）。

**「默认毛利率」与「预警线」是两个数，不是一个数（v1.12 新增）**

客户第二次提「选了项目类型，毛利率没有跟着变」时才想清楚：这其实是两个问题被一个下拉挡住了。

| | 预警线 `warn_rate` | 默认毛利率 `default_margin_rate` |
|---|---|---|
| 干什么 | 低于它就**变琥珀色**（只影响颜色，永不拦出单） | 建单时**预填进毛利率输入框**，并作为反推售价的入参 |
| 谁在用 | 汇总条的着色 | `createQuote` / 换类型时的初值 / 「按毛利率重算」 |
| 缺省 | 全局 25% | 该类型没填 → 输入框留白（可以留空建单） |
| 填成同一个数的后果 | 建单初值正好压在自己的警告线上 —— 报价员一进来就是琥珀色，于是他把琥珀色当常态，负毛利那天也不会多看一眼 | |

> **为什么不合并在一个字段里**：预警线是"最低可接受"，默认毛利率是"我们通常报多少"，现实中前者 18%、后者 35%，中间那 17 个点是报价员的议价空间。合并成一个数，要么天天报警，要么永远不报警。

**联动规则（四处同源，别再各写一遍）**

| 位置 | 行为 |
|---|---|
| 新建报价单弹窗 | 选类型 → 毛利率当场填上该类默认值，hint 变「按「品牌发布会」的默认值填好，可以改」；没配的类型**不清空**手上已填的数（不覆盖用户输入） |
| 编辑页单头 | 换类型且本单毛利率没被单独指定过 → 跟着换；**只改类型，不碰已有行的对客价**（要重算得自己点「按毛利率重算」，那条有确认弹层） |
| 设置 · 报价规则 | 每个类型两列：预警线 / 默认毛利率，中间那道说明必须留在页面上 |
| 百分比输入框 | 一律 `rateToPctInput()`，不许写 `n * 100` —— `0.28 * 100 = 28.000000000000004`，框里就成一串没法看的数 |

- 折扣：支持整单折扣（%），折扣后重算对客合计与毛利率，并在汇总条显示 `原 ¥90,000 → 折后 ¥86,400（-4%）`。

#### 含税口径：它不是一句声明，它是「取哪个成本价」的开关（v1.3 重做）

> **这一条我上一版做错了，而且错得很危险。** 我把「以上报价为含税价」当成页脚说明文字，还写了「与比价的关系：完全无关」。
> PM 的 6.6.9 纠正：同一供应商同一物料可以同时存在两条价（「要票 3200 / 不要票 2900」是行业常态，TC-4.1），**出单时选哪条成本，取决于这张单声明的是哪个口径**。所以这行值是 `resolvePrice()` 的入参。
> 做成装饰文字的后果是：用户以为报的是含税价，实际成本按不含税取，**整单毛利算高、报出去亏钱，而且没人发现**——因为它不会报错，只是数字变漂亮了。**这是所有错误里最坏的一种。**

**位置：从页脚提到表单区，和 `毛利率` 并排（两个都是"整单级参数"）**

```
┌ ← BJ-2614 · 星海科技 2026 年会《向新而行》      草稿已存 09:41   [预览客户版] [导出 v] ┐
│ 客户 星海科技 · 活动日 2026-01-18 · 场地 杭州国际会议中心 3F                        │
│ 口径 [ 含税 ][ 不含税 ] · 毛利率 40%(≈成本 × 1.667) [改]  ↑ 是真开关                   │
```

| 项 | 规范 |
|---|---|
| 控件 | **分段控件二选一**（`含税` / `不含税`），36px 高，占据单头信息区第 2 行左端。**不做自由文本输入**——口径是枚举，文案才是可自定义的 |
| 位置 | **单头信息区**（表单区），与 `毛利率` 同一行。**不属于明细表下方**——那里只是注释的位置，会让人以为它不影响数字 |
| 字段与默认值 | 落在 `quotes.tax_statement`，**存 `inclusive` / `exclusive` 两个英文码**，默认 `inclusive`（客户 Q7 确认默认报含税价）；创建时从 `app_settings.tax_statement_default` 复制，出单前可改 |
| 为什么不存中文 | 架构给的理由成立且是本条的要害：**它是 `resolvePrice()` 的入参，不是文案。** 存中文字面量意味着出单时要做一次中→英映射，映射表漏一个值（有人手输「含税价」而非「含税」）取价就静默走错分支。**存码、渲染文案，零映射，出单时 `tax_basis = quotes.tax_statement` 同名同值域直接透传** |
| 改它之后 | **全单所有行的成本与毛利当场重算**，与"改数量"同级的响应（150ms 数字过渡），**不等保存、不刷新页面** |
| 切换前的提示 | 见下，`当前有 N 行成本将变化` |
| 客户版输出 | 按当前口径渲染 `inclusive` / `exclusive` **对应的那一句声明**（在合计下方、条款上方，独立一行）。客户版只出现一句话，不做双栏对照 |
| 两句声明（归设计，文案存设置可改） | `inclusive` → 「以上报价为含税价，税率另计」；`exclusive` → 「以上报价为不含税价，税额另计」（架构把渲染句式定在接口文档里，我这里给最终中文，两边一字不差） |
| 内部版导出 | 额外打印 `取价口径：含税（2026-11-04 王磊设定）`，让复核的人知道成本是按哪个口径取的 |
| 系统不出现的东西 | 不做税率输入框、不按 6% / 13% 反算、不做「含税/不含税双栏对照」。等 P1 有 `tax_rate` 了，那是"导出模板加一列"，不是重构 |

**切换口径时的提示：必须给整单合计的前后数字（v1.5 重做，我上一条写错了）**

> **我上一版写了「只说成本会变、不说金额会变」，理由是"怕吓到人"。这个前提是错的，而且错得和含税口径那件事同源。**
> 按 PRD 6.6.5：自动定价行的 `对客价 = 成本 ÷ (1 − 毛利率)`——**成本一变，对客价必变，整单合计必变**。只有手工改过对客价的行不跟着变。
> 所以"金额不变"在多数情况下是假的。后果正是我们自己描述的那一类：**用户以为只是换了个口径标签，实际手里这张单的总额已经变了，然后发给客户——系统全程绿灯，数字还很漂亮。**
> PM 的判据我原样抄进文档：**会报错的错误是安全的，不报错的错误才是危险的。**

```
┌ 换口径要重新取成本价 ────────────────────────────────────────────┐
│  换成「不含税」后，系统会重新查每一行的成本价：                    │
│                                                              │
│   · 3 行成本会变，其中 3 行是自动定价（对客价跟着变）             │
│   · 1 行是手工定价，只有毛利变，对客价不动                        │
│   · 另有 1 行只有含税价，切过去会变成缺价（对客价保持原值，不清零） │
│                                                              │
│   整单合计：¥13,166.67  →  ¥12,308.33                          │
│                                  ↑ 18px 590，这是唯一真正要看懂的数│
│                                                              │
│   举例：金桥桁架厂 含税 ¥3,200 / 不含税 ¥2,900                  │
│                                                              │
│                              [ 取消 ]  [ 换，重算 4 行 ]       │
└──────────────────────────────────────────────────────────────┘
```

**三个必选项（TC-4C.2 / 4C.3 / 4C.4，一条都不能少）**

| # | 必须给出 | 为什么 |
|---|---|---|
| 1 | **切换前后的整单合计** `¥13,166.67 → ¥12,308.33` | 这是用户唯一真正关心的数字。**没有这个数字的确认框只是免责声明，不是提示。** |
| 2 | **区分自动定价行与手工定价行** | 后果不同：前者改金额，后者只改毛利。混在一起说，用户会以为全都会变或者全都不变 |
| 3 | **预告会变缺价的行** | 否则他点完发现某行红了，会以为是 bug |

**缺价行的对客价保持原值，不清零（PRD 6.6.8，这条我也想反了）**

- 切到不含税后，若某行查不到对应口径的价 → **成本变红、`cost_source` 转 `manual`，但对客价保持切换前的值**。
- 理由（PM 的，我认同）：**对客价是商务判断（已经想清楚甚至跟客户谈过），成本缺失是数据问题。用数据问题去清掉商务判断，会让用户在补价的那一瞬间丢掉已定的售价，而他自己没注意。**
- 而且**缺价行仍计入整单合计**——否则提示里给的新合计与实际发出的单对不上，又变成"看起来对、实际错"。

**其余细节**

- **N = 0 时不弹窗**，直接切，按钮下方一行 `已切换，这单没有受影响的成本行`（TC-4C.7）。
- **举例一个真实价差**（TC-4C.8）：`金桥桁架厂 含税 ¥3,200 / 不含税 ¥2,900`。用户当场能核对，比十句解释有用。
- **切换响应与改数量同级**（TC-4C.9）：150ms 数字过渡，不等保存、不刷新页面。
- **文案与值分离**（TC-4C.10）：值存 `quotes.tax_statement`（`inclusive` / `exclusive` 两码），界面那句声明文案存设置里可改。**不得把文案当数据存。**
- **方向不许写死（v1.7 补）**：客户 Q7 定默认 `inclusive`，所以绝大多数单子的**第一次切换是「含税 → 不含税」**——上面这个弹窗就是那个方向。但**代码里不许把方向写成常量**：弹窗的标题动词、`换成「X」`、按钮文案 `换，重算 N 行`、以及两个合计数字的先后，全部由 `from` / `to` 两个变量拼，`from → to` 与 `to → from` 都要能跑。一张声明为不含税的单子切回含税时，全套文案与数字必须镜像。
- **成本取价口径默认跟随本单声明**，不跟随"第一条有效价"、也不跟随设置页当前值（设置页只影响**新建**的单）。这条别再搞混：`quotes.tax_statement` 是单据属性，`app_settings.tax_statement_default` 只是建单时的初值。

> **为什么不能做成"含税/不含税双栏对照表"**：PM 的 6.6.9 讲清了——双栏对照需要 `tax_rate` 才能算准差额，而 MVP 不采集税率。**一个会算错的对照表比没有更糟**，用户会以为两栏数字都是对的，然后拿去做决策。

#### 三种视图态：编辑 / 预览 / 导出（PRD §6.6.6，三者不是一回事）

| 视图 | 成本列 | 毛利列 | 进入方式 | 为什么这样设计 |
|---|---|---|---|---|
| **编辑态** | 显示 | 显示 | 默认 | 不显示就没法定价，这是工作必需 |
| **预览态** | **默认隐藏**，有显式切换按钮，**每次进入都重置为隐藏** | 默认隐藏 | 顶栏 `预览客户版` | 防"投屏给客户看"和"手滑截图发群"——这是真实发生过的场景 |
| **导出 · 客户版** | 物理不存在 | 物理不存在 | 汇总条 `生成报价单` 后自动下载 | 物理隔离（不是隐藏） |
| **导出 · 内部版** | 显示 | 显示 | `导出 v` → `导出内部版`（**member 置灰**） | 老板复核。仅 admin 可产出这份可转发资产 |

> **预览态的隐藏必须是"每次重置"，不能记住上次选择。** 记住选择是最常见的错——某人为了核对开了一次成本列，下次直接投屏就带出去了。**危险默认值绝不允许被粘性记住。**

#### 导出对照表（PRD §11.3 + TC-12）

| | 客户版 PDF | 客户版 Excel | 内部版 |
|---|---|---|---|
| 谁能导出 | admin / member | admin / member | **仅 admin**（TC-12.7） |
| 成本 / 毛利 / 毛利率 | **无** | **无** | 有 |
| 不在客户版显示的行 | **整行不存在**（6 行，不是 8 行留空） | 同左 | 有（行尾标注 `客户版未显示`） |
| 软陈旧 / 手填标注 | 无 | 无 | 行尾 `价格 N 天未核价` / `手填成本` |
| 公式 | — | **保留「单价 × 数量 = 金额」公式**，客户改数量能自动算 | 保留 |
| 命名区域 / 隐藏列 | — | **不得含任何命名区域、隐藏列** | — |
| 渲染来源 | 服务端从 `CustomerQuoteDTO` 重新组织 | 同左 | 服务端从内部 DTO |
| 参考最低价 / 高于最低价 | **绝不出现**（TC-12.11，等级同成本） | **绝不出现** | **必须是两个独立列**（不在屏幕那套「一格两行」里继承） |

> **为什么屏幕上一格两行、导出必须是两列（PRD v1.4 §6.6.6）**：屏幕上省 88px 是因为 1366 不能横滚（§C.7 明细表），那是**屏幕的约束**；而内部版是一份给人复盘、可能打印、可能对比两个月份的文件，**平面文档里"位置关联"（第二行跟着第一行）在筛过、排过、复制到别处之后就不成立了**。所以导出的内部版要有 `参考最低价` / `高于最低价` 两个真列，`高于最低价` 空着 = 没贵。这条是我上一版的遗漏，PM 补的。

**两条导出路径，不是一个开关（TC-12.6 —— 这条改变了我上一版的交互）**

上一版我把导出做成 `导出 v` 下拉里选「客户版 / 内部版」，这本质上还是一个"含不含成本"的开关。PM 的用例把这件事说清了：**客户版是服务端从独立 DTO 重新渲染的文件，不是把你屏幕上这一版藏掉几列。** 所以：

- 客户版与内部版是**两个独立的服务端渲染器**，输入是两种不同的 DTO。前端**没有**"当前视图 → 打印"这条路径。
- `CustomerQuoteDTO` 里**物理不存在** `cost_*` / `margin_*` / `markup_*` 字段。flag 方案最容易漏，已排除。
- 导出前服务端自检：成本相关字段出现次数 **= 0**，不为 0 直接中止并记错误日志（TC-12.5）。

**导出权限（TC-12.7，我此前漏掉的权限洞，PM 补的）**

| 能力 | `admin` | `member` |
|---|---|---|
| 屏幕查看成本与毛利 | 是 | 是（不算就看不了价） |
| 导出客户版 | 是 | 是 |
| **导出内部版（含成本）** | 是 | **否** |

> **这条权限的定性：`降低顺手转发`，不是「保密」。**
> `member` 屏幕上本来就能看到成本，截图照样能截。所以这个限制的收益是**把一个"顺手导出、随手转给客户"的动作变成"要去找管理员"的动作**，仅此而已。
> **因此界面上不写任何承诺性措辞**——不出现「安全」「保密」「防泄露」「数据已加密」这类词。写上去的后果不是多一层保护，而是**让人以为平台在兜底，然后更放心地把成本截图发出去**。置灰那一项的说明文字只有事实：`内部版含成本，仅管理员可导出`。

> 区分逻辑是 PM 那句很准的话：**屏幕可见是即时行为，导出文件是可转发资产，风险量级不同。** 能算毛利 ≠ 应该能产出一个能转发出门的含成本文件。

`member` 登录时的表现（**不许只灰掉让人猜**）：

```
导出 v
┌──────────────────────────────────────────┐
│ 导出客户版 PDF                           │
│ 导出客户版 Excel                         │
│   客户版不含供应商报价附件（3 张）         │  ← 11px 灰，两角色都显示
├──────────────────────────────────────────┤
│ 导出内部版（含成本）          lock       │  ← 置灰 + 不可点
│ 内部版含成本，仅管理员可导出              │  ← 11px 灰色解释，常驻
└──────────────────────────────────────────┘
```

- **不隐藏这一项，只置灰**。藏起来的结果是：member 想给老板看内部版，找不到按钮，以为系统坏了，跑去问人——而解释文案只有一行，成本近乎为零。
- 解释文案固定为 `内部版含成本，仅管理员可导出`，不加"抱歉""您没有权限"这类措辞。
- 若真成高频阻碍，P1 再加"指定成员可导出内部版"的授权开关。**MVP 不做**：宁可让老板自己点一下，也不要在 MVP 里开一个可能被滥用的权限档。

**附件：客户版只带物料图，不带供应商报价截图（PRD v1.8 §6.6.10 / TC-14C 组，v1.7 新增）**

> 附件挂在两处，性质完全不同：`PricedItem`（物料参考图、淘宝链接——**对客材料**）与 `PriceBook`（供应商报价截图——**底账证据**）。
> 客户版**只带前者**。这不是排版问题，是同一件事的两种说法：**成本不只在数字里，也在截图里**——一张供应商报价截图上有单价、有供应商名、有微信聊天记录。

| 做 | 规范 |
|---|---|
| **导出对话框给一行带数字的说明** | `客户版不含供应商报价附件（3 张）`。带数字是关键：用户"明明传了图却没带上"的疑惑，只有给出**具体几张**才能被回答；写"部分附件不会导出"等于没说 |
| 位置 | 导出菜单的客户版两项下方，11px `--fg-meta`，**不折叠、不 hover 才出**。它是菜单里唯一的非动作行，靠缩进与弱色区分 |
| 数字 = 0 时 | **整行不渲染**。没有附件却说"不含 0 张"是噪音 |
| 内部版 | 该行不出现（内部版带全部附件）。内部版的附件区额外标注 `供应商报价附件 3 张 · 仅供内部核对` |
| 为什么不弹确认框 | 这不需要用户决策，只需要他知道。弹框会让人以为"要不要带"是可选项，而它其实不是 |
| 不写的话术 | 不写「出于保密考虑」「为保护供应商信息」——按 §C.7 的定性，这里只陈述事实，不做承诺 |

**另外两条附件边界（会改文案，不改结构）**

| 边界 | 我的界面处理 |
|---|---|
| **附件不做物理删除**（PRD v1.8） | 删除物料 / 删除价格的确认文案**不许写"彻底删除""不可恢复"**。改成：`删除后这条物料不再出现在库里，但已发出的报价单里的图仍会保留。` <br>原来的"删除后不可恢复"是**错的事实**——用户会以为历史单会空。**写错事实比不写更糟**：他真的按"不可恢复"做了决定，然后发现图还在，从此不信任何确认框 |
| **外链只存不抓、SVG 不进白名单** | 上传组件的 `accept` **显式列** `image/jpeg,image/png,image/webp,application/pdf`，**不写 `image/*`**。`image/svg+xml` 可内嵌脚本，同源打开即 XSS；`accept` 写通配就一定会有人传进来。另：`accept` 只是 UI 提示，**前端必须在 `onChange` 里再校验一次 MIME + 扩展名**，服务端还要校验第三次 |

**客户版模板的四个概念（TC-12.2 反过来约束排版）**

客户版 PDF 全文检索「成本」「cost」「毛利」「profit」必须 **0 命中**。所以客户版模板**只准出现四个概念**：

| 允许 | 禁止（连出现在标题、页脚、汇总行里都不行） |
|---|---|
| 单价 | 成本、成本单价、成本合计、成本小计 |
| 数量 | 毛利、毛利率、利润率、盈亏 |
| 金额 | 加价、加价率、加成率 |
| 合计 | 内部价、底价、真实成本 |

**还有两个词也在这个禁令里，容易被当成"业务字段"漏掉**：`参考最低价` 与 `高于最低价`（TC-12.11）。它们是内部核对用的，一旦出现在客户版上，等于告诉客户"我们知道你贵了"——**这比露出成本数字更伤关系**。

- 列头只能是 `名称 / 规格 / 单位 / 数量 / 单价 / 金额`，**没有第七列**。
- 页脚只能是 `合计 ¥128,460.00` + 口径声明 + 有效期 + 公司名，**不出现任何"利润多少"的暗示**（连"优惠后"这类词都要慎用，它暗示了原价里有什么）。
- **这条对设计的实际约束**：客户版不是"内部版的精简版"，它是一份**重新设计的单据**。我在 §C.8 预览页把成本开关删掉，原因就在这里——那开关本身就是错误模型。

**「不在客户版显示」= 整行剔除，不是金额置零（TC-12.1）**

| | 做对了 | 做错了 |
|---|---|---|
| 行数 | 8 行变 **6 行**，序号连续重排 | 8 行仍在，2 行金额显示 `—` 或 `0` |
| 分组小计 | 按 6 行重算 | 把隐藏行算进小计，客户一加就对不上 |
| 客户感受 | 一份干净的 6 项报价 | "为什么有两行是空的？是不是漏了？" |

- 编辑器里那行**必须保留在屏幕上**（灰字 + 虚线底，见 v1.1 修正表第 2 条），但**导出时物理剔除**。
- 若某分组全部行都被隐藏 → 该分组标题在客户版里**整块不出现**，不留一个空标题。

> **硬约束（给架构师/前端）**：客户版必须在**服务端生成时就剔除**成本字段——
> ① 走独立 `CustomerQuoteDTO`（不含 `cost_*` / `margin_*`），不是同一个 DTO 加 flag；
> ② PDF/Excel 渲染函数只接受该类型；
> ③ 隐藏行在 SQL 层 `WHERE` 掉，不查出来再过滤；
> ④ **导出前自检 `成本字段出现次数 = 0`，不为 0 直接中止并记录一条错误日志**。
> ⑤ Excel 里"隐藏列被右键取消隐藏就露了"是这个行业最常见的坑，所以不是"隐藏"，是"不存在"。

#### 发送前自检（PRD P0 第 14 项 / 6.6.7，按 TC-8 定稿：7 条 warning + 1 条 blocker）

> **这不是审批流。** 它拦的是"蠢单"，不是"没权限的单"。
> **7 条 warning 一律不阻断**：用户确认即可发出，不产生待办、不改变状态。
> **唯独 1 条 blocker（客户名为空）阻断 `issued`**，因为报价单是对外文件，没有客户名就不是一份可发出的文件（TC-8.5）。
> 而草稿不阻断（TC-8.6）：存草稿时客户名可以空着。**阻断只在出单这一个动作上。**

**blocker：客户名为空（阻断，不弹"仍要继续"）**

```
┌ 发不出去 ────────────────────────────────────────────────────┐
│  circle-alert 20px  客户名还没填                              │
│                                                              │
│  报价单是要发给客户的，抬头空着发不出去。                       │
│                                                              │
│                                     [ 去填客户 ]  [ 存草稿 ]  │
└──────────────────────────────────────────────────────────────┘
```
- 只有一个出路 + 一个退路（存草稿），**没有"仍然生成"**。给了就等于没拦。
- 灰掉 `生成报价单` 时按钮 tooltip 也写这一句，用户不用点开才知道。

**7 条 warning：命中任一条就弹清单（全部命中一次全列出，不逐条弹）**

```
┌ 发出前，看一眼这 4 件事 ──────────────────────────────────────┐
│                                                              │
│  (!) 整单毛利率 18.4%，低于你设的 25%                          │
│      对客 ¥90,000.00 / 成本 ¥73,440.00                        │
│                                                              │
│  (!) 第 4 行「LED 屏 P3.91」成本 ¥420.00，但同是租赁·按天       │
│      别家最低 ¥380.00（星光灯光）。这行多花 ¥960.00。            │
│      [ 换成星光灯光 ]                                          │
│                                                              │
│  (!) 第 9 行「兼职礼仪（1.88m）」成本是手填的，价格库里没有       │
│      这个人的价。内部版上会标出来。                             │
│                                                              │
│  (!) 第 6 行「喷绘布 550」的价 123 天没核过了。                 │
│                                                              │
│                                  [ 回去改 ]  [ 都看过了，生成 ]│
└──────────────────────────────────────────────────────────────┘
```

| # | 条件 | 清单文案 | 右侧快捷动作 |
|---|---|---|---|
| 1 | 整单毛利率 < 阈值 | `整单毛利率 18.4%，低于你设的 25%` | — |
| 2 | 存在 `cost_source = manual` 的行 | `第 9 行成本是手填的，价格库里没有这个价` | `去录一条价`（admin）/ 无（member） |
| 3 | **存在成本单价 > 该主体「同性质、同计价方式、同税口径」的最低有效价的行** | `第 4 行成本 ¥420，但同是租赁·按天 别家最低 ¥380（星光灯光），这行多花 ¥960` | `换成星光灯光` |
| 4 | 存在软陈旧价格的行 | `第 6 行的价 123 天没核过了`（写**实际天数**，不写阈值——阈值是设置项，会变） | `去核价` |
| 5 | 存在单行亏钱的行（`line_profit < 0`） | `第 5 行亏 ¥1,200，对客价低于成本` | `去改价` |
| 6 | 存在对客单价 = 0 的行 | `第 8 行对客价是 0，客户会看到一行不要钱的东西` | `去改价` |
| 7 | 某价的 `effective_to` 早于本单活动日 | `第 3 行的价 2026-01-05 就到期了，活动是 2026-01-18` | `去更新` |

> **第 3 条的四个限定词缺一不可**：`同性质` + `同计价方式`（**人员用该条价的 `unit_mode`，不是 `items.pricing_mode`**）+ `同税口径` + `最低有效价`。
> 少了「同计价方式」，人员那边就会拿「按天 ¥1,500」去劝一个「按场 ¥2,800」的主持人——和买断/租赁完全相同的事故。
> 少了"同性质"，系统就会拿 ¥500/天 的租价去劝一个买断单"你贵了"，**这条自检会从最有价值的一条变成最危险的一条**——它会让报价员把买断价改成租价，那正是 PRD §6.6.1 要防的亏损。
> 少了"同税口径"，含税价和不含税价比出来的差价是假的（PRD §6.6.3）。
> 少了"有效"，会拿失效价当基准。

> **第 3 条是这套自检里最有价值的一条**——它直接防住"明明有便宜的不选"。报价员在赶时间时经常从"常用供应商"里随手挑一个，而忘了这个物料别家更便宜。这条清单把差价算成具体金额摆出来，比任何流程都有效。

**按钮主次（这一处我做了个反直觉的选择，PM 已认可）**：
- **主按钮 = `回去改`（朱砂填充）**，次按钮 = `都看过了，生成`（描边）
- 理由：这张弹窗**出现的时刻，本来就说明已经出了点问题**。默认应该把人推回去改；真想强行发的人多一次点击是合理的摩擦。反过来把"生成"做成大按钮，用户会闭眼点，自检等于没做。
- 若 7 条全部命中但用户坚持生成 → 第二次点击时按钮文案变 `确认发出（已看过 7 条）`，再点一次才执行。两层，不烦，但拦得住手滑。

**不弹窗的情形**：7 条全不命中 → 直接生成，无任何确认框（TC-8.4）。**不要加"确定要生成吗"这种纯噪音。**

> 为什么 warning 一条都不许做成阻断（TC-9 的教训延伸）：**一旦把 warning 做成阻断，用户会学会闭眼点"仍然继续"，然后所有提醒一起失效**——提醒的价值取决于它有多罕见。

#### 生成后的通知（PRD §11.3 补充）

- 报价单状态转 `issued` 后，给所有 `admin` 发一条**站内通知**（顶栏铃铛）：
  `王磊 生成了一张报价单：星海科技《向新而行》· ¥128,460 · 毛利率 41.5%`
- 通知里带三个快捷动作：`看这单` / `看内部版` / `知道了`。
- **不做邮件、不做微信推送**（内部工具，站内够了）。管理员可在设置页关掉。

#### 状态机（PRD §10 明确只有三态）

```
draft（草稿）──生成报价单──> issued（已发出）──作废──> void（已作废）
   ▲                            │
   └──────复制重报 version+1─────┘
```

- **没有「已成交」**（属项目/CRM 范畴，Out-of-Scope）。
- **没有「待审核」**（不上审批流）。
- 状态只影响三处：台账筛选器、操作按钮可用性、工作台"待处理"口径。
- 状态徽章：`草稿` 灰描边 / `已发出` 绿描边 / `已作废` 灰实底 + 删除线。

#### 键盘（Excel 位移模型，报价员的手不用离开键盘）

| 键 | 行为 |
|---|---|
| 单击单元格 / `Enter` | 进入编辑 |
| `Enter` | 提交并下移到同列 |
| `Tab` / `Shift+Tab` | 提交并右/左移 |
| `Esc` | 取消编辑恢复原值 |
| `↑` `↓` | 移动当前行 |
| `⌘D` / `Ctrl+D` | 复制当前行到下一行 |
| `Alt+↑` / `Alt+↓` | 上下移动行 |
| `Del` | 删除行（5 秒撤销 Toast） |
| `⌘Z` / `⌘⇧Z` | 撤销 / 重做 |
| `⌘E` | 导出客户版 PDF |
| `⌘Enter` | 生成报价单（缺价时 disabled，按下弹出缺价行定位） |

#### 空态 / 保存态

- 空：`单子还是空的。左边搜「背景板」试试，勾上点「攒进报价单」。` + 次按钮 `照上次年会那单起个头`
- 保存中：顶栏 `正在保存…` + `loader-circle`
- 保存失败：顶栏 `没存上，点这重试`（`--danger`，可点）
- 生成成功：Toast `报价单已生成 BJ-2614。客户版 PDF 已准备好。` + 两个按钮 `下载客户版` / `下载内部版` / 第三 `发通知给老板`
- 生成后状态徽章从 `草稿` 变 `已发出`，编辑器**转为只读**（TC-13.2）：明细不可编辑、抽屉不展开、行操作全部禁用，顶栏出现一条横幅 `这张单已经发出去了。要改，只能复制重报成新版。` + 主按钮 `复制重报（生成 v2）`。
- **不做"提示了但允许改"**。允许改会造成两个后果：客户手里那份和系统里那份不一样；`version` 这个字段变成没人管的计数器。**快照不变性（TC-11）是这套系统能对外报价的信任基础。**

---

### C.8 报价单列表 `/quotes` 与预览导出 `/quotes/:id/preview`

**列表**

```
┌ 报价单 ───────────────────────────────────────────────────────── [+ 新建报价单] ────┐
│ [ 搜单号 / 客户 / 活动名]   [状态 v] [负责人 v] [时间 v]                          │
│ 状态：全部 · 草稿(2) · 已发出(57) · 已作废(5)        按状态排序，草稿在最前  ← v1.14 │
│                                                                                    │
│ ┌─┬────────────┬──────────────────────┬─────────┬───────────┬────────┬───────────┐ │
│ │[ ]│单号         │客户 / 活动            │状态      │对客合计    │毛利率   │最后编辑    │ │
│ ├─┼────────────┼──────────────────────┼─────────┼───────────┼────────┼───────────┤ │
│ │[ ]│BJ-2615     │星海科技 / 新品发布会   │草稿      │¥96,200.00 │41.2%   │今天 09:12  │ │
│ │[ ]│BJ-2614     │星海科技 / 年会《向新而行》│草稿     │¥128,460.00│53.0%   │昨天 18:42  │ │
│ │[ ]│BJ-2608     │恒安集团 / 客户答谢宴   │已发出    │¥64,800.00 │46.8%   │09-24       │ │
│ │[ ]│BJ-2597     │远见资本 / 开业庆典     │已发出    │¥212,000.00│38.5%   │09-18       │ │
│ │[ ]│BJ-2590     │恒安集团 / 三季度团建   │已作废    │¥0.00      │—       │09-11       │ │
│ └─┴────────────┴──────────────────────┴─────────┴───────────┴────────┴───────────┘ │
│ 共 64 张                                                          < 1 2 3 4 >       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**默认口径：全部状态，草稿在最前（v1.14）**

客户原话：「进入报价单页面显示全部状态的报价单，按状态排序草稿优先。」

- **默认不筛状态**。上一版默认落在「草稿」——因为草稿是待办，看起来合理；但用户真实的第一动作往往是"我上周发出去那张，客户改了个数"——那在默认视图里根本看不见，还得先想起来去切筛选。**默认应该回答"我有哪些单"，不是"我还欠什么"。**
- **排序**：`CASE status WHEN 'draft' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, updated_at DESC`。草稿在最前（那是正在动的），已发出居中，已作废垫底。同一状态内按最后编辑倒序——这一条与原来一致。
- **计数器写在筛选区右侧**：`草稿 2 · 已发出 57 · 已作废 5`。三个数一次给全，用户不用切筛选也知道总量；只给当前筛选的条数等于让人自己算。
- **「按状态排序」是默认序，不是唯一序**：点表头「状态」还能反着排（已作废在前），这时就按显式 `sort` 走，不再注入草稿优先。默认序和显式排序必须是两条路——把默认序塞进通用排序器会拼出 `DESC DESC` 这种字符串，翻页时才炸。
- 已作废的单**照常列出**（灰字、金额列 `—`）。作废不是删除，客户撤销了还要恢复；藏起来会让人以为单子没了。

**预览导出 `/quotes/:id/preview`**

> **v1.2 重做**：这一页上一版是"内部版加一个『隐藏成本与毛利』勾选框"——PM 的 TC-12.6 把这条路否了。**客户版是服务端从 `CustomerQuoteDTO` 重新渲染的文件，不是屏幕上这版藏掉几列。** 所以这里只预览客户版，成本开关整个删掉；内部版是另一条导出路径，且只有 admin 能点。

```
┌ ← 返回编辑   预览 · 客户版 BJ-2614                              [打印] [导出 v] ┐
│ ┌──────────────────────────────────────┐  ┌─ 客户版排版 ────────────────────┐ │
│ │              星海科技                  │  │ 版式   ● 详细  ○ 精简           │ │
│ │      2026 年会《向新而行》活动报价      │  │ 分组   [x] 按分类分组             │ │
│ │      报价单号 BJ-2614                 │  │ 单价   [x] 显示单价 ○ 只显示金额   │ │
│ │  ─────────────────────────────────    │  │ 折扣   [x] 显示原价与折后          │ │
│ │  一、舞美硬体                          │  │ 附录   [ ] 附物料图片             │ │
│ │  桁架 3m 方管   16 根/天  45  ¥720    │  │ 条款   [默认条款 v]             │ │
│ │  桁架横梁       12 根/天  32  ¥384    │  │                                │ │
│ │  …                                    │  │ 以上报价为含税价，税额另计        │ │
│ │                                       │  │                                │ │
│ │  合计                         ¥128,460│  │ [ 导出客户版 PDF ]              │ │
│ │                                       │  │ [ 导出客户版 Excel ]            │ │
│ │  以上报价为含税价，税额另计              │  │ ─────────────────────────      │ │
│ │  报价有效期 30 天 · 杭州星芒活动策划     │  │ 导出内部版（含成本）  lock      │ │
│ └──────────────────────────────────────┘  │ 内部版含成本，仅管理员可导出     │ │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **这一页只有客户版**。屏幕上不再有任何"成本/毛利"字样——因为客户版模板里根本没有这些概念（TC-12.2），预览什么都看不到才是对的。
- **「打印 / 导出客户版 PDF」和「导出客户版 Excel」是同一份版面（v1.12 重做）。** 客户原话是"打印出来的页面要跟 Excel 保持一致"——上一版是两边各写各的：预览是一套 HTML 表格、Excel 是另一段 JSX 之外的拼装代码，列宽、抬头、分组小计、合计标签各有偏差，同一张单能看出两个样子。现在只有一个真相源：
  - `src/domain/customer-sheet.ts` 纯计算，产出 `{ 抬头三行, 列定义, 分组行 + 序号, 合计标签与金额, 优惠行, 税额说明, 页脚 }`，按 `layout / grouped / unit_price / discount` 四个开关算，不碰 DOM、不碰 ExcelJS。
  - 两个渲染器：`components/quote/paper-sheet.tsx`（HTML，屏幕/打印/PDF 共用）和 `server/services/export.service.ts::writeCustomer`（xlsx）。
  - 四个开关从预览页一路透传到 `export.xlsx?layout=&grouped=&unit_price=&discount=`，保证"勾了什么就出什么"。
  - **任何在 `paper-sheet.tsx` 里"多加一列""换个表头文案"的改动都是 bug**：它同时改了三个出口，但只改了其中两个的样式。要改版面就改 `customer-sheet.ts`。
  - 打印态（`@media print`）：`@page { size: A4; margin: 14mm 12mm }`、`thead` 跨页重复、`tr { break-inside: avoid }`、工具栏/右侧面板 `.no-print`、纸面 `min-width: 0` 防横向溢出。这些是浏览器的活，不由服务端给分页点——预览的 A4 白纸是**尺寸与字号对得上**，不是逐页渲染。
- **左侧纸面是服务端 `CustomerQuoteDTO` 的渲染色样**，不是编辑器状态的 CSS 折叠。若哪天有人给这条链路加一个 `hideCost` 参数，那就是回退到 flag 方案，必须拒。
- 右侧「客户版排版」四个选项只影响客户版的**版式**（详细/精简、分组、单价显隐、折扣显式、附录、条款），**没有一个选项与成本有关**。这一条是判断"是不是还在用 flag 思维"的试纸。
- 「不在客户版显示」的行，在这一页**看不到**——不是灰掉，是不存在。行数会比编辑器少（TC-12.1）。
- 导出 Excel 保留分组与公式（客户可能自己改数量），这是从 Excel 迁移过来的用户最在意的兼容点。
- 内部版入口在这一页也有，但 `member` 看到的是置灰项 + `内部版含成本，仅管理员可导出`。

### C.9 设置页 `/settings`

```
┌ 设置 ──────────────────────────────────────────────────────────────────────────────┐
│ ┌ 设置导航 200 ─────┬─ 内容 ────────────────────────────────────────────────────────┐│
│ │ 用户与角色     ●  │ 用户与角色                                     [+ 邀请成员]    ││
│ │ 分类字典          │                                                                ││
│ │ 比价与计价规则     │ 成员                    角色      状态      最近登录           ││
│ │ 报价单模板        │ 王磊（你）              管理员    正常      今天 09:02   ⋯     ││
│ │ 导出与打印        │ 陈默                    管理员    正常      今天 08:51   ⋯     ││
│ │ 系统              │ 李思雨                  成员      正常      昨天 17:20   ⋯     ││
│ │                  │ 赵一鸣                  成员      已停用    08-14        ⋯     ││
│ │                  │                                                                ││
│ │                  │ 能力                      管理员    成员                     ││
│ │                  │ 查价 · 比价 · 看趋势      可        可                       ││
│ │                  │ 新建报价单 · 出单         可        可                       ││
│ │                  │ 屏幕看成本与毛利          可        可                       ││
│ │                  │ 手填成本（只影响本单）    可        可                       ││
│ │                  │ 新建一条价（含版本化复制）可        可                       ││
│ │                  │ 覆盖 / 停用已有价         可        不可                     ││
│ │                  │ 改交易性质 / 折算系数     可        不可                     ││
│ │                  │ 导出客户版                可        可                       ││
│ │                  │ 导出内部版（含成本）      可        不可                     ││
│ │                  │ 供应商档案 / 分类字典     可        不可                     ││
│ │                  │ 设置项 / 账号管理         可        不可                     ││
│ └──────────────────┴────────────────────────────────────────────────────────────────┘│
```

- 左侧 200px 二级导航，右侧单栏内容，不用 Tab（Tab 在设置页会横向溢出）。
- 成员页面对非管理员：改价能力行显示 `lock` + "仅管理员"，且实际按钮 disabled + tooltip，不是隐藏（隐藏会让人以为系统坏了）。

#### 「比价与计价规则」页 —— 6 个可配项，全部不许硬编码

> **原则**：凡是"客户实际情况可能不同"的数字，都必须在这里改，不能写死在代码里。这 6 个值目前都是 PRD 的估计值（25% / 90 天 / 40% 已挂 R11），客户上线后一定调。

| # | 配置项 | 默认 | 影响哪里 | 变更风险 |
|---|---|---|---|---|
| 1 | **毛利率预警阈值（按项目类型分 5 个 + 一个默认）** | 默认 **25%**，5 个类型各一个可填 | 报价单汇总条着色 + 发送前自检第 1 条 | 只影响提示，**绝不阻断、不禁用出单** |
| 2 | **价格陈旧阈值（软陈旧）** | **90 天** | 比价页琥珀徽章 + 工作台第 ③ 块 + 自检第 5 条 | 改小 → 提示变多；改大 → 提示变少 |
| 3 | **默认毛利率** | **40%** | 新增行的对客价初值 | 只影响新行，不改历史单 |
| 4 | **出单通知开关** | **开** | `issued` 后是否给管理员发站内铃铛 | — |
| 5 | **默认含税口径**（`inclusive` / `exclusive`） | **`inclusive` 含税**（客户 Q7） | 新报价单的 `quotes.tax_statement` 初值，**进而决定 `resolvePrice()` 按哪个口径取成本** | 只影响新单；已建单不变。**这不是文案项，是取价项** |
| 6 | **报价有效期天数** | **30 天** | 客户版 PDF 页脚 + 列表页"将过期"提示 | — |

- **没有第 7 项「默认加价率」**：这个词已从系统里删掉（PRD §6.6.5 明确不出现加成率），统一叫「默认毛利率」。
- **不做"含税/不含税"双栏对照**（两栏并排的数字）。但**第 5 项本身是取价开关，不是文案开关**——v1.3 之前的我在这里写"只改声明文案，不改计算结果"，那是错的：它决定 `resolvePrice(tax_basis)` 取哪一条价，切换时整单成本与合计都会变（§C.7）。**双栏对照不做，是因为没有税率算不准；口径开关必须做，因为不做就会按错口径取价。这两个判断不冲突。**
- 第 1 项的 5 个类型值**逐项可留空**，留空 = 用默认 25%。表单长这样：
  ```
  毛利率预警阈值
  默认            25 %
  年会 / 庆典     — % （留空）
  品牌发布会      22 %
  展台特装        — % （留空）
  路演 / 地推     — % （留空）
  长期框架客户    18 %
  （留空 = 用默认 25%）
  ```
  **留空回退，不做"必须全填"**——逼管理员给 5 个类型都编一个数，他会全部填 25%，等于没分。
- 每项右侧带一行灰字说明改了会影响什么（上表第 4 列的内容直接抄上去），**不要让管理员靠猜**。

#### 「分类字典」页 —— 两棵树，各 8 类，不设「其他」

| | 物料树（`item_type = 'material'`） | 人员树（`item_type = 'personnel'`） |
|---|---|---|
| 8 类 | 舞美硬体 · 灯光音响AV · 印刷物料 · 桌椅布草 · 美陈软装 · 礼品物料 · 餐饮服务 · 场地设备 | 主持司仪 · 演艺资源 · 影像团队 · 策划设计 · 执行搭建 · 礼仪模特 · 专业嘉宾 · 支持人员 |
| 为什么分开 | 物料和人不会互相归类（把"主持人"拖进"印刷物料"是荒谬的） | 人员的计价方式是 `unit_mode`（由该条价的 `unit_code` 派生），与物料的 `pricing_nature` 是两套字段 |
| 可编辑（v1.10 定案） | **改名 + 新增（可挂一级或挂到某个一级下）**，仅管理员。删除 / 合并 / 拖拽排序**暂不做**：分类下面挂着主体和价，删掉等于让一批记录无处归属；合并要先把主体一个个移过去（改档案，今天就能做）。做不了的按钮不如不做 | 同左 |
| 不设「其他」 | **不设**。真的出现第 9 类就给客户自己加一类——「其他」会变成一个什么都往里扔的垃圾桶，半年后分类就废了 | 同左 |

- **单位字典只是一张 11 项枚举表（PRD §6.4），不含任何换算系数。** 上一版我在这里写过"单位字典（含换算系数，如 1 块 LED 箱 = 0.25 ㎡）"，v1.2 已删除：折算系数是**每个物料自己的规格事实**（同一款 LED 箱和另一款不一样），不是全公司统一的换算常量，放进设置页只会造成"改了这里，所有物料都跟着变"的错误。折算一律在**单条价格记录**上填 `base_unit_qty`（§C.4B）。
- 供应商类型是固定 5 值（`线上电商 / 线下定做厂 / 灯光音响商 / 经纪公司 / 自有`，与 §C.6 枚举表逐字一致），由架构师在 Schema 里定，本页只读展示。
- **专业嘉宾必须独立成类**，不许埋进"演艺资源"——这是 PM 第 6 条里点名的一条（找嘉宾和找舞蹈演员是两个采购渠道，报价差 10 倍）。

#### 作废 / 恢复 / 删除（v1.10 补，客户三条要求：管理员能删、成员能作废恢复、分类字典能改名）

**分界线是「可逆性」，不是「重要性」。** 作废换个状态，一条「恢复」就回来了；删除是真从库里消失。

| 对象 | 作废（`POST …/archive`） | 恢复（`POST …/restore`） | 删除（`DELETE`） | 删除的连带影响 |
|---|---|---|---|---|
| 报价单 | 草稿与已发出都能作废 | 回到作废前的状态：有 `issued_at` → 已发出，否则 → 草稿 | **任意状态**（含已发出），软删 `deleted_at` | 单号、金额仍留在库里可查证，只是列表里不再出现 |
| 物料 / 人员 | `is_active = false` | `is_active = true` | 真删 | **连带删掉这个主体自己的价**（不留孤儿价）；历史报价单靠行快照不受影响 |
| 物料价 | `status = archived`，不再参与比价与取价 | 回到 `active`；若这段时间已有同口径在效价，**40902 并说出是哪家哪段**，不硬改 | 真删 | 连带删掉变更日志与附件；趋势图里这条消失 |
| 供应商 | `is_active = false` | `is_active = true` | 真删 | **有价时拒绝**：`这家供应商还有 N 条价格（涉及 M 个物料）…先删掉它的价，或者用「作废」` |

**角色**：作废 / 恢复两种角色都能点（`canArchive`）；删除只有管理员（`canDeleteRecord`）。成员点删除时服务端 403 的文案固定为「只有管理员能删除 X。你可以用「作废」——作废之后随时能恢复。」——不只说不行，还要给出那条能走的路。

**为什么物料连带删价、供应商却拒绝删**：删一个物料只带走它自己那几家的价；删一家供应商会一次性带走十几个物料上的价，那些物料的其他报价还在，于是比价表里"最便宜的一家"会静默换人，而没人知道原因。爆炸半径不同，处理方式就不能一样。

**入口在哪**：
- 报价单列表操作列：`继续编/看客户版` + `作废`|`恢复` + `删除`(admin)
- 物料库 / 人员库操作列：`+` `编辑` + 作废|恢复 + 删除(admin)；工具栏右侧「含已作废」开关（默认关）
- 供应商列表操作列：`看报价` + 作废|恢复 + 删除(admin)；「含已作废」开关
- 物料价：比价页下方可折叠的「价格记录」表（作废 / 恢复 / 删除）。**为什么不挂在比价卡片上**：比价区只显示在效的价，被作废的那条根本不在卡片里，恢复就永远没有入口

**「含已作废」这个开关不是可选项**：作废之后看不见，用户会以为数据丢了；想恢复一条时找不到它，恢复功能等于不存在。开关打开后，已作废的行在名称旁带「已作废」徽章——只靠"开了筛选才出现"来区分身份太隐晦。

**草稿也能作废**（v1.10 改的状态机）：原来只允许 issued 作废，于是成员建错一张草稿会走进死胡同——不能删（管理员专属）、不能作废。为了清一张空单去打扰管理员，这种系统没人愿意用。

---

## D. 关键组件设计规范

### D.1 比价卡片组件 `<SupplierPriceCard>`（v1.1 主组件）+ `<PriceCompareTable>`（次选视图）

#### D.1.1 卡片（默认，PRD §7.2 指定形态）

**卡片内部的子栅格（跨卡片数字能对齐的唯一办法）**

```
┌────────────────────────────────┐  248px 宽 · 208px 高
│ [最低]              租赁商 16px │  ← 徽章区 24px：左「最低」，右「供应商类型」
│ 星光灯光             今天 09:24 │  ← 名称行 20px：14px/590 + 11px 时间
│ ──────────────────────────────  │  ← 分隔 1px（不是卡片边框，是内部栅格线）
│                        ¥500.00 │  ← 价格区 40px：22–26px/590，右对齐
│ /㎡/天 · 不含税 · 起订 1㎡       │  ← 单位行 16px：11px/--fg-3，三段用 · 分隔
│ ──────────────────────────────  │
│ 无阶梯                         │  ← 命中档 20px
│ 交期 1 天 · 长期有效            │  ← 辅助行 16px
│ 近 12 月  展开 v               │  ← 趋势入口 20px（hover 才亮）
└────────────────────────────────┘
         ↑ 所有行的左边缘都在 16px 处，价格右边缘都在 16px 处
```

| 部位 | 规范 |
|---|---|
| 尺寸 | 宽 ≥ 248px（`--cmp-grid-min`），高 208px（展开趋势时 328px），圆角 8px，边框 1px `--border` |
| 排列 | `grid-template-columns: repeat(auto-fill, minmax(248px,1fr))`，gap 16px，**同性质内按命中单价升序** |
| 徽章区 | 左：`最低` 徽章（**仅同性质、同口径、N≥2 时的最低价卡**）+ 并列时 `最低 · 并列`。右：**`自有` 徽章（仅 `supplier.type === 'internal'` 时出现）** + 供应商类型徽章（`线上电商` / `线下定做厂` / `灯光音响商` / `经纪公司` / `自有`，图标 16px + 文字 11px，见 §C.6 枚举表）。`自有` 徽章用 `--badge-internal-fg` / `--badge-internal-bg`（= info 系），不用绿/红——自有不是"更好"也不是"更差"，是**口径不同** |
| 供应商名 | 14px / 590 / `--fg`，单行截断（`title` 补全）；右侧更新时间 11px `--fg-meta`，超过阈值转琥珀并加 `clock-alert` |
| 单价 | 22px / 590 / `tabular-nums` / **右对齐**；最低价卡 **26px** |
| 单位行 | 11px `--fg-3`：`/㎡ · 含税 · 起订 10㎡`，三段用 `·` 分隔。**税口径必须是三段之一，不许省** |
| **折算价（双层）** | 单位 ≠ 主体比价单位且填了 `base_unit_qty` 时：价格区大字号显示**折算价** `¥60.00/㎡`，下方 **11px 灰字 `原报 ¥5.00/张（1㎡ = 12 张）`**。原价必须看得见——否则用户不知道 60 怎么算出来的，会不信这个数，进而不用这个功能 |
| **未折算（降级态）** | 单位 ≠ 主体比价单位且 `base_unit_qty` 为空时：单价位置显示原值 `¥5.00/张`，价格区右上角琥珀徽章 `未折算`；卡片**排在已折算行之后**、**不参与最低价**、**不给最低徽章**；点击攒单时弹提示 `这家按「张」报价，攒进单里就按张计（12 张 ≈ 1㎡）。要折算先去补一下。` |
| 阶梯命中 | 13px：命中成功绿字 `命中 100–499 档`；无阶梯灰字 `无阶梯`；断档琥珀 `按 10–29 档计` |
| 交期/有效期 | 11px `--fg-3`：`交期 3 天 · 长期有效` |
| 趋势入口 | 底部 20px：`近 12 月  展开` + `chevron-down`，点击展开 120px 迷你折线 |
| 最低价卡 | 2px `--price-lowest-border` + `--price-lowest-bg` 底 + `最低` 徽章 + 26px 字号（五重编码，见 §C.4） |
| 不可选卡 | 起订量不满足时：`opacity: .55` + 单价删除线 + 琥珀原因徽章；`cursor: not-allowed`；不响应 hover 抬升 |
| hover | 边框转 `--accent-border` + `translateY(-1px)` + `--shadow-1`（150ms）；**不做缩放**（缩放会让相邻卡片文字发虚） |
| 无障碍 | 整卡 `role="group"` + `aria-label="星光灯光，租赁价，每平方米每天 500 元，不含税，当前最低"`；Tab 进入后 `Enter` 选中、`Space` 勾选；**折算价与未折算都必须被读出来** |
| 埋点 | 卡片点击 `compare_card_opened`；攒单 `compare_card_added`（带 `pricing_nature`、`is_normalized`） |
| **录入人 / 改价人** | 卡片底部趋势入口右侧一行 11px `--fg-meta`：`王磊 录 09-24 · 陈默 改 10-02`（`created_by` / `updated_by`）。**这是 R15 的伴生需求**——三个选项都要它，所以先做：① 出问题时能问对人；② 让"谁录的"变成可见的社会压力，比任何权限都更能治乱录；③ 表格视图加一列 `录价人` + 顶部按人筛选 |

**卡片的四种状态，一一对应到数据条件（前端别自己发明第五种）**

| 状态 | 条件 | 视觉 |
|---|---|---|
| 正常可比 | 单位一致 或 已填折算；税口径与同组一致 | 普通卡 |
| 组内最低 | 同上 + 命中价 = 同组最低 + N ≥ 2 + 税口径一致 | 五重编码 |
| 未折算/口径不一致 | `base_unit_qty` 空 / 税口径与同组不同 | 琥珀徽章、不排序、不标最低 |
| 不可选 | qty < 起订量 | 降灰 + 删除线 + 原因 |

**卡片为什么不用左侧彩条表示类型**：类型已经有图标 + 文字徽章，再加彩条就是三重编码，而且左侧竖条是 AI 模板的典型特征（本文件已列禁令）。

#### D.1.2 表格视图（次选，位于同一页的切换后）

| 能力 | 规范 |
|---|---|
| 用途 | 给"数字党"和老 Excel 手；不作为默认 |
| 列 | 供应商 / 类型 / 单价 / 命中档 / 含税 / 起订量 / 交期 / 有效期 / 更新 / 操作 |
| 冻结 | 冻结「供应商 / 类型」两列，`--table-sticky-col-shadow` |
| 最低价单元格 | 底 `--price-lowest-bg`、字 `--success`、`--fw-medium`、`最低` 徽章 |
| 并列最低 | 两格都标，徽章 `最低 · 并列`，tooltip `两家同价 ¥28.00` |
| 缺失报价 | `—`（em dash，`--table-cell-num-muted`），hover：`这家没报这个物料 [新增报价]`。数据来自接口的 `missing_suppliers[]`——不要用「供应商全集 减 有价行」自己推，那样会把已停用供应商也算进来 |
| 单位不一致 | 单价旁 `ruler` 16px + 琥珀 `单位不同`；**不进排序、不参与最低价** |
| 排序 | 默认单价升序；可切「按更新时间」；**排序后最低价底色仍跟随真实最低价，不跟随第一行** |
| 状态同步 | 与卡片视图共享同一个 `qty` 状态，切换不重置 |

### D.1B 数量档切换器 `<QtyTierSwitch>`（v1.1 新增，PRD 关键交互）

| 项 | 规范 |
|---|---|
| 结构 | `label "数量"` + 分段控件（4 档位，36px 高）+ 自定义输入（72px 宽，右侧带单位）+ 右侧 `按 300 ㎡ 计算` 灰字 |
| 档位来源 | 该主体全部供应商阶梯价断点的并集，取出现频次最高的 ≤4 个 |
| 默认值 | 第一个档位的起点（通常是起订量） |
| 切换 | 150ms 内所有卡片单价更新（数字淡出淡入，不做位移）+ 卡片 200ms FLIP 重排 + 摘要条同步 |
| 键盘 | `←` `→` 切档；敲数字直接跳进自定义输入；`Enter` 确认；`Esc` 退出输入回档位 |
| 边界 | 输入 > 单日最大量（如 999999）不拦截，但卡片全部显示 `已享最高档` |
| 空值 | 清空自定义输入 = 回到上一个有效档位，不出现 `0 ㎡` |
| 埋点 | 每次切换上报 `compare_qty_switched`（PRD §12 关键验证指标） |

### D.1C 交易性质 Tab `<NatureTab>`（v1.2 新增，PM 硬要求：必须在摘要条之上）

| 项 | 规范 |
|---|---|
| 何时渲染 | `pricing_nature` 种类 > 1 才渲染。**只有一种时整条不渲染**，省下 40px 给卡片 |
| 位置 | 数量档切换条之下、摘要条之上（因为摘要条要跟随它） |
| 高度 | 40px（`--cmp-nature-tab-h`）；横向滚动而非换行（性质最多 3 种，1366 下不滚） |
| 单个 Tab 结构 | `组名（13px/590）+ 家数（11px/--fg-3）+ 组内最低价（13px/tabular-nums）`，例如 `租赁·按天  3 家  ¥500/天` |
| 选中态 | 文字 `--fg` 590 + 2px 朱砂下边线（`--accent`）；未选中 `--fg-3` 510，hover 转 `--fg-2` |
| 三种降级文案 | 只有 1 家 → `只有 1 家`；税口径混 → `口径不一致`；无有效价 → `没有能用的价`。**任何情况下都不编一个「最低」出来** |
| 排序 | 固定 `租赁·按天 → 买断 → 定制加工`（活动公司 90% 是租，放第一减少滚动）；无数据的性质不出现 |
| 默认选中 | **行数最多的那一组**（TC-3.6）。不用 `default_pricing_nature`——用户这次要看的是「哪一类报价最多」，而不是「这个物料建的时候被标成哪类」 |
| **人员复用** | `item_type === 'personnel'` 时同一组件渲染 **`unit_mode`**（这一条价自己的）：`per_day` 按天 / `per_event` 按场 / `per_person_day` 按人天 / `per_hour` 按小时 / `per_half_day` 按半天。字段换了，交互与降级规则一模一样。**不要传 `items.pricing_mode` 进来**，那是档案默认值 |
| 键盘 | Tab 获得焦点后 `←` `→` 切换；`Home`/`End` 跳首尾。**与数量档切换器抢方向键的解决**：只有当前持焦的控件响应，另一个不监听 |
| 切换时 | 不改 `qty`；卡片区 200ms 交叉淡出（不做位移动画，因为整组内容都换了）；摘要条同步；埋点 `compare_nature_switched`（带 `from`/`to`/`qty`） |
| 无障碍 | `role="tablist"` + `aria-selected`；面板 `role="tabpanel"` + `aria-labelledby` |

> **这个组件存在的唯一理由是防亏损，不是分类美观。** LED 屏买断 ¥8,000 / 租赁 ¥500 一天，混在一列标「最低 ¥500」会让报价员按租价报一个需要买断的活动。如果哪天有人提议「Tab 太占地方，合并成一列吧」——请他先看 PRD §6.6.1。

### D.2 阶梯价展示 `<TierPriceList>`

```
阶梯价  金桥桁架厂
┌───────────────┬──────────┐
│ 1 – 9 根      │ ¥48.00   │
│ 10 – 29 根    │ ¥45.00   │  ← 当前命中（底 var(--price-lowest-bg)，左侧 check 图标）
│ ≥ 30 根       │ ¥41.00   │
└───────────────┴──────────┘
数量 16 → 命中 10–29 档，单价 ¥45.00
```

| 场景 | 表现 |
|---|---|
| 表格单元格内 | 只显示 `3 档` 的 11px 灰字链接，hover 弹出 Popover（宽 220px）显示完整阶梯 |
| 详情页 | 常驻卡片，命中档高亮 + `circle-check` |
| 输入数量时 | 实时提示 `数量 16 → 命中 10–29 档，单价 ¥45.00`，150ms 内更新 |
| 阶梯断档 | 琥珀 warning 条：`第 2 档结束于 29，第 3 档从 35 开始，30–34 没有价格。[修正阶梯]`；且该数量下的命中价**回退到 PriceBook 单价**并留一条"阶梯未覆盖"警告，不阻断（TC-1.10） |
| 阶梯重叠 | 录入时**警告但允许保存**（TC-1.11）；比价/出单取价时按 `min_qty` **降序**取第一个满足条件的档，保证结果确定 |
| 无阶梯价 | `这家没设阶梯价，统一 ¥45.00。` + `设置阶梯价` 文字按钮 |

### D.3 价格趋势图 `<PriceTrendChart>`

| 项 | 决策 | 理由 |
|---|---|---|
| 图型 | **折线图**（非柱状），`recharts@3.10.1` 的 `type="stepAfter"` 阶梯线 | 要读"变化趋势"不是"对比构成"；柱状在 12 个月 × 5 商家时密不透风。**价格是分段常数，用线性插值会画出"中间价位"这种不存在的价格**——这条比样式重要 |
| X 轴 | 时间（按数据点，不强行等距）；刻度按区间自适应：3M→周、6M/12M→月 | 价格是**事件驱动**的（改价才有一个点），强行等距会撒谎 |
| Y 轴 | 单价，从数据 min 下方 15% 起，不从 0 起 | 从 0 起会把 45→48 的变化压成一条直线，看不出任何信息。轴标签明示 `¥` 与"非零起点" |
| 多供应商 | **多条线**，最多 5 条；>5 家时取"最近有更新的 5 家 + 其他（聚合均值虚线）" | 超过 5 条线人眼无法区分 |
| 线样式 | 2px 实线 + 改价点 3px 圆点；最低价那条 `--chart-1` 最粗且置顶 | — |
| 图例 | 图下方横向 chip，可点击开关单条线；默认全开 | 图例必须能关，否则看不清 |
| 参考线 | 1px 虚线 `--chart-reference` + 标签 `当前基准价 ¥48.00` | 报价员关心"现在比基准高还是低" |
| 区间切换 | `[3月] [6月] [12月] [全部]` 分段控件，右上角 | — |
| 数据点 | hover 出竖直参考线 + 十字标签：`2026-08-12 · 金桥桁架厂 ¥45.00（较上次 -6.3%）` | — |
| 空态 | `< 2` 个点：`只有 1 次记录，攒够 2 次才能画趋势。` + `记录一次新价格` | 只有 1 个点画折线是荒谬的 |
| 无障碍 | 图表必须有 `<table>` 等价数据（可 `sr-only` 或"查看数据表"切换）；不用颜色单独区分线条，加不同 `stroke-dasharray` | 色盲用户必须能读 |

### D.4 报价单行编辑器 `<QuoteLineRow>`

| 交互 | 规范 |
|---|---|
| 进入编辑 | 单击单元格即进入编辑（不是双击——双击在密集表里太慢）；`Enter` 也可 |
| 编辑态样式 | 单元格内换成无边框 input，底 `var(--surface)`，外圈 1px `--accent` + `0 0 0 3px rgba(210,67,31,.12)` |
| 提交 | `Enter` 提交并下移到同列下一行（Excel 习惯）；`Tab` 提交并右移；`Esc` 取消（恢复原值）；失焦提交 |
| 数字输入 | 只接受数字与 `.,-`；`1,200` → `1200`；`1.2万` → `12000`；非法输入抖动 80ms + 保留原值 + 右侧红字 `只填数字` |
| 数量单位换算 | 若输入单位 ≠ 物料基准单位，行下方灰字提示：`按 12 张/㎡ 折算 ≈ 300 张（= 25 ㎡）` |
| 单价覆盖 | 对客价默认 = 成本单价 × (1 + 默认毛利率)，用户手改后该格右上角出现 2px 朱砂小三角标记"已手改"；hover 出 `恢复按毛利率计算` |
| 供应商切换 | 成本单价格点击弹 Popover 列出该物料全部供应商报价，选中即替换成本单价并重算；当前选用项打 `circle-check` |
| 小计 | 只读，`--fg-3`，实时重算，200ms 数字过渡 |
| 毛利率 | **行级只显示数值、不按阈值着色**（每行加价策略天然不同，行级告警天天误报）。唯一例外：**< 0 时**数字转 `--danger` 并加 `circle-alert`——负毛利是真的亏钱，与「低于阈值」不是一回事。阈值只作用于整单汇总条（§C.7） |
| 删除行 | `Del` 或行尾 `trash-2`；删除后 5 秒内底部 Toast `已删除 1 行 · 撤销`（`⌘Z` 亦可） |
| 复制行 | `⌘D` 或 `copy` 图标，复制到下一行 |
| 移动行 | `Alt+↑/↓` 或拖 `grip-vertical`；移动时行有 2px `--accent` 上/下边线指示落点 |
| 批量 | 勾选多行 → 底部浮条 `已选 3 行 [改折扣] [删除] [移入分组]` |

### D.5 空 / 加载 / 错误 状态（真实文案，直接抄）

> v1.1 修订：空状态是本产品**用户第一次接触的地方**（PRD §7.1 强调）。文案全部改成"说人话 + 给一个具体动作"，禁止"暂无数据"。

| 场景 | 文案 | 主操作 | 次操作 |
|---|---|---|---|
| **物料库空（首次进入）** | `还没有录过物料价。先录一条试试：选个供应商，填个单价，写个生效日期就够了。` | `录第一条价` | `先建个物料` |
| **人员库空** | `还没有录过人员价。先录个主持人的价试试——选个供应商或填个人名，写清是按天还是按场，别把口径搞混了。` | `录第一条人员价` | `从常见工种开始` |
| 物料库空（有物料无价格） | `物料建了 12 个，但一个价都没有。没价的物料在比价时是空的，报价时也用不上。` | `开始录价` | `先看看已有的物料` |
| 物料无任何报价 | `这个物料还没有供应商报价。先记一条淘宝采购价，之后比价才有依据。` | `新增报价 +` | `先放一放` |
| 物料只有 1 家报价 | `只有金桥桁架厂一家报价，没法比价。再记一家（哪怕是别家的口头价），才好判断贵不贵。` | `再录一家` | — |
| 比价 · 单位不一致且未折算 | `星光灯光按「块/天」报价，本物料基准是「㎡/天」。填一句「1 ㎡ = 多少块」才能放进排序。` | `填上` | `先这样，不排序` |
| 比价 · 已折算（提示，不是错误） | `星光灯光的 ¥5.00/块 已按 1㎡ = 12 块折算成 ¥60.00/㎡，参与比较。` | — | `改折算` |
| 比价 · 税口径混着 | `这一组里有的含税、有的不含税，差价里混着税，不能直接比。标了含税/不含税，你自己看口径。` | `去补口径` | `知道了` |
| 比价 · 一组里只有 1 家能比 | `只有 1 家能比，看不出贵不贵。` | `再录一家` | — |
| 比价 · 没有能比的价 | `这一组 3 家都因为单位或税口径不一致，暂时没法比。` | `填换算关系` | `看原始报价` |
| 比价 · 已失效价格收起来了 | `3 条价已经过期，收在下面了(不参与比价)。` | `展开看看` | — |
| 报价单空 | `单子还是空的。左边搜「背景板」试试，勾上点「攒进报价单」。` | `照上次年会那单起个头` | — |
| 报价单无客户 | `客户没填。导出 PDF 时客户名会显示「未填写客户」。` | `补填客户` | `就这样` |
| 人员档期冲突 | `李思雨 9/28 已被「年会《向新而行》」占用。同日再排会撞档。` | `换人` | `仍要排（记备注）` |
| 毛利为负 | `第 5 行「LED 屏 P3.91」报价低于成本 ¥1,200，整单毛利 -4.2%。确认这样出单？` | `回去改价` | `确认出单` |
| 价格过期（列表/详情） | `喷绘之家的报价 187 天没更新，行业喷绘价近半年涨了约 12%。` | `去更新` | `知道，先这样` |
| 删除供应商（危险确认） | `删除「金桥桁架厂」会影响 47 条价格记录、6 张历史报价单。价格记录将归档到回收站（30 天内可恢复）；已发出的报价单是快照，不受影响。` | `输入供应商名称确认` → `删除并归档` | `取消` |
| 加载（表格） | 骨架屏 6 行（行高一致，避免 CLS），表头真实渲染 | — | — |
| 加载（比价/趋势） | `正在拉 4 家供应商的 47 条价格…` + 进度条（>800ms 才出现） | — | — |
| 错误（接口超时） | `价格没加载出来（接口超时）。下面是 3 分钟前的缓存，可能不是最新。` | `重试` | `先看缓存` |
| **错误 403（想覆盖已有价）** | `这条价只有管理员能改。`<br>`你要报一个新的价，可以新建一条——旧价会在今天结束，历史都还在。` | `新建一条价` | `关闭` |
| **错误 403（想改交易性质 / 折算系数）** | `交易性质和换算关系只有管理员能改。`<br>`要按别的口径报，就新建一条价，这条不动。` | `新建一条价` | `关闭` |
| **上传 413（超出大小）** | `这张 6.2MB，超过 5MB 上限。压一下再传，或者换一张。` | `换一张` | `关闭` |
| **上传 415（类型不支持）** | `不支持 .svg 格式。可以传 jpg / png / webp / pdf。` | `换一张` | `关闭` |
| **删除物料 / 价格的确认** | `删除后这条不再出现在库里，但已发出的报价单里的图仍会保留。` | `删除` | `取消` |
| 无搜索结果 | `没找到「冷焰火」。换个说法试试，或者直接新建。` | `新建「冷焰火」` | `搜供应商` |
| **录价：保存成功** | `录好了。金桥桁架厂 28.00 元/㎡，旧价已结束。` | `再录一家` | `关掉` |
| **录价：重叠确认**（内联条，非 Modal） | `这家在 2025-01-01 起有一条 ¥32.00 的价（长期有效）。保存后旧价将在此结束：2026-11-04。` | `确认，结束旧价` | `改生效日` |
| **录价：离开保护** | `转 3 秒，还有没保存的。`（3 秒后自动留在抽屉里，不关） | `继续填` | `不要了` |
| **出单：缺价（按钮禁用，但不是死路）** | `第 7 行「李工（行业讲师）」还没有成本。填一个就能出单——估的也行，但别拿失效的价顶。` | `手填成本` | `按旧价重新录价`（仅当有失效旧价时出现） |
| **出单：`42205 NO_VALID_PRICE`（该供应商在本单口径下没有有效价）** | `金桥桁架厂在这个口径下没有有效价（最近的价 2025-03-11 已失效）。` 与「这个物料还没有任何报价」**必须分开**：前者是**问过、但这家的这个口径没价**，后者是**压根没问过** | `手填成本` | `看这家别的口径` / `按旧价重新录价` |
| **出单：按旧价重新录价成功** | `已按 2025-03-11 的 ¥3,200 重建为今天生效的新价（旧价已结束）。这条价已经进了价格库，下次比价就能用上。` | `撤销`（10 秒内） | `知道了` |
| 出单：负毛利（不阻断） | `这单是亏的（-4.2%，差 ¥3,780）。有些单就是要亏着出，你确认就行。` | `回去改价` | `确认出单` |
| **出单：价已过期** | `2 行用的是 90 天前的价。确认无误可以出单，内部版上会标注。` | `去更新` | `确认出单` |
| 权限受限（禁用态） | 按钮 disabled + tooltip `仅管理员可改成本价` | — | — |

---

## E. 交互细节

### E.1 键盘操作

| 键 | 作用域 | 行为 |
|---|---|---|
| `⌘K` / `Ctrl+K` | 全局 | 命令面板：搜物料/人员/供应商、跳页面、执行动作（新建报价单、导出当前单） |
| `/` | 页面 | 聚焦当前页搜索框（已聚焦时输入 `/` 不拦截） |
| `?` | 全局 | 快捷键帮助面板 |
| `N` | 物料库/人员库/报价单列表 | 新建当前实体 |
| `G` 然后 `M`/`S`/`V`/`Q`/`H` | 全局 | 跳转 物料/人员/供应商/报价单/工作台 |
| `⌘B` / `Ctrl+B` | 全局 | 折叠/展开侧边栏 |
| `↑` `↓` / `J` `K` | 表格 | 移动当前行（当前行有 1px `--accent` 内描边） |
| `Tab` / `Shift+Tab` | 报价单明细 | 右移/左移一格；到行尾自动下一行首 |
| `Enter` | 报价单明细 | 进入编辑 / 提交并下移同列 |
| `Esc` | 编辑态 | 取消编辑，恢复原值 |
| `Space` | 表格 | 勾选/取消当前行 |
| `Shift+Click` | 表格 | 区间勾选（从上次锚点到当前行） |
| `⌘A` / `Ctrl+A` | 表格（焦点在表内） | 全选当前页（顶部 Toast 提示 `已全选本页 20 项`） |
| `⌘Z` / `⌘⇧Z` | 报价单 | 撤销 / 重做（行删除、数量修改、价格覆盖） |
| `⌘D` | 报价单明细 | 复制当前行到下一行 |
| `Alt+↑/↓` | 报价单明细 | 上下移动当前行 |
| `⌘Enter` | 报价单 | 完成（保存并离开） |
| `⌘E` | 报价单 | 导出 PDF |
| `Del` / `Backspace` | 明细行 | 删除当前行（带 5 秒撤销 Toast） |

**快捷键可见性**：所有按钮 hover 时若有关联快捷键，在 tooltip 右侧显示 `<kbd>` 样式（11px、底 `--gray-100`、边框 `--gray-200`、圆角 2px）。`?` 面板列出全部。**不做"新手引导弹窗"**——引导弹窗是内部工具最容易被骂的东西。

### E.2 数字输入的容错

| 用户输入 | 解析结果 | 提示 |
|---|---|---|
| `1200` / `1,200` / `１２００`（全角） | `1200` | 无 |
| `1.2万` / `1.2w` | `12000` | 输入框下方 11px 灰字 `已按 1.2 万 = 12,000 处理` |
| `¥45` / `45元` / `45.00/㎡` | `45` | 静默剥离符号与单位 |
| `-45` | 拒绝 | 红色 `金额不能为负，如果是退项请单独加一行负数项` |
| `45.555` | `45.56` | 静默四舍五入（单价 2 位小数上限） |
| `1e3` | `1000` | 无 |
| `abc` | 保留原值 | 抖动 80ms + `只填数字` |
| 数量 `12张`（物料单位为 ㎡，换算 12 张/㎡） | `12` | `按 12 张/㎡ 折算 ≈ 1 ㎡` |
| 数量 `3*4` | `12` | `已按 3 × 4 = 12 计算`（活动行业常见：3 排 × 4 列） |
| 折算填 `1`（单位不同时） | 不接受 | 红色 `1 张 = 1 ㎡ 的话，把单位改成「㎡」就行`（TC-2.10） |
| 折算填 `0.2` | 不接受，并给出**一键换基准单位**的出口 | 琥珀 `0.2 张 = 1 ㎡ 是说反了吧？要不要改成按「张」比价？那样就是 1 张 = 0.2 ㎡ 的整数关系。` + 按钮 `改成按张比价`（TC-2.13） |
| 空值 | 不参与合计，行标琥珀 `数量未填` | — |

**原则**：报价员在客户现场打电话改数，输入必然是不干净的。系统负责猜，猜完告诉他怎么猜的，但绝不悄悄改成完全不同的数。

### E.3 危险操作与确认分级

| 级别 | 操作 | 交互 |
|---|---|---|
| L0 无确认 | 改数量、改对客价、加行、删行、改备注 | 立即执行 + 可撤销（`⌘Z` / Toast 撤销） |
| L1 轻提示 | 删除已存在的报价单草稿、批量删除行、作废报价单 | 单一确认 Modal（一句话 + 主按钮 `删除`（`--danger` 填充）+ `取消`），**不要求打字** |
| L2 强确认 | 删除供应商、删除物料、删除分类、修改单位字典换算系数 | Modal + **必须输入对象名称**才能启用删除按钮 + 明确列出影响面数字 |
| L3 双人 | 无（3–10 人团队不需要审批流，增加摩擦只会绕过系统） | — |

**L2 确认框模板**（以删供应商为例）：
```
┌ 删除供应商 ──────────────────────────────────────────┐
│  triangle-alert 24px  删除「金桥桁架厂」？             │
│                                                       │
│  会影响：                                             │
│    · 47 条价格记录 → 归档到回收站，30 天内可恢复        │
│    · 6 张历史报价单 → 是快照，不受影响                 │
│    · 3 个物料会变成「只有 1 家报价」，无法比价          │
│                                                       │
│  输入供应商名称确认：                                  │
│  [ 金桥桁架厂                                    ]     │
│                                       [取消] [归档并删除]│
└───────────────────────────────────────────────────────┘
```
- 主按钮在输入完全匹配前 `disabled`（opacity .45，`cursor: not-allowed`）。
- 危险按钮底色 **`--danger-fill`**（不是 `--danger`——`--danger` 是文字族，用它当底色是把两种语义搅在一起），hover `--danger-fill-hover` `#73150D`，白字 `--danger-on` 9.25:1。
- Modal 入场 200ms `--ease-out`，`prefers-reduced-motion` 下直接出现。

### E.4 反馈与乐观更新

- **乐观更新**：改价、改数量、加行、勾选 → 界面立即变，请求后台发。失败时该行左侧 2px `--danger` 竖线 + 行尾 `circle-alert` + Toast `这次改动没保存上（网络断了）。已恢复成改之前的数。`
- **Toast**：右下角，宽 320px，4 秒自动消失，最多堆 3 条，可 hover 暂停。位置避开底部汇总条（汇总条上方 12px）。
- **保存状态**（报价单编辑器顶栏右侧）：`草稿已自动保存 09:41`（`--fg-3` 12px）/ 编辑中 `正在保存…` + `loader-circle` / 失败 `没保存上，点这重试`（`--danger`，可点击）。
- **不打断**：只有 L1/L2 用 Modal；其余全部用行内提示 + Toast。

### E.5 响应式与兼容（v1.4：布局按宽度，只读按指针）

| 宽度 | 布局 | 具体行为（**布局按宽度算，能不能改按指针算**） |
|---|---|---|
| ≥1600 | 完整 | 内容区居中最大 1600；比价卡片 6 列；表格全列展开 |
| **1440–1599** | **完整·PRD 基准宽** | 比价卡片 **4 列**（内容区 1176）；明细表完整 13 列；页面边距 32px |
| **1366–1439** | **完整·PRD P0 下限** | 比价卡片仍 **4 列**（内容区 1102，248px 是卡片硬下限）；明细表完整 13 列；页面边距 24px；**禁止横向滚动条** |
| 1024–1365 | **完整·布局降级** | 侧边栏折为 56px 图标栏；比价卡片 3 列（1280–1365）/ 2 列（1024–1279）；明细表切「精简 9 列」；**编辑功能完整可用** |
| 桌面但很窄（如 900px，`pointer: fine`） | **完整·允许横向滚动** | TC-12B.2 明确：这类用户**必须仍可编辑**，允许出现横向滚动条。**「禁止横向滚动」只约束 ≥1366 这条 P0 基线**，不是全局禁令——把"不能横滚"当成全站规则，就会在窄窗口上砍掉编辑能力，那正是我们要避免的误伤 |
| **375–1023** | **只读查看** | 见下「移动与窄屏」。可查价、看比价、看报价单；**不提供录入与编辑** |
| **<375** | 提示 + 仍可看金额 | 顶部一行 `屏幕太窄了，横过来看更清楚。` **但报价单的客户名 / 合计金额仍然渲染出来**（客户 Q4 定：<375 提示过小但仍可看金额）——把这一页做成纯提示页，等于在客户面前打不开单子。不做其它降级布局 |

**为什么 1024 以下给"只读"而不是"阻断"**（PM v1.1 已修正，我采纳）
上一版我写的是"<1024 阻断"，PM 指出那是拒绝用户，不是保护用户。改成只读之后，项目经理在现场用手机查价这件事**真的被解决了**，而不是"提示你去用电脑"。

**但 PM 的三级边界有一个必须打的补丁，我按设计判断提出来请确认：**

**判定条件：只判指针，不判宽度（PM 让我定，我定这个）**

```css
/* 只读 = 触摸设备。宽度只决定布局，不决定能力 */
@media (pointer: coarse) { /* 切只读模式 */ }
```

- **为什么去掉 `width < 1024` 前缀**：PM 的反驳是对的——加上这个前缀会让「iPad 横屏 1200px + 触摸」变成可编辑，而**用指头在 13 列表格里改价是另一种难用**（点不准、drag 不到、误触相邻行）。宽度的正确职责是决定布局，不是决定能力。
- 大屏 iPad 接键盘的用户：`pointer` 媒体查询在接了鼠标/触控板后会变成 `fine`，系统自动恢复完整编辑——**不需要写代码，浏览器已经处理了**。这是我最后决定单独判的关键原因：这个"例外"本来就存在，不用我们兜。
- MacBook 窗口拖窄到 900px（fine）→ 照样能改价，只是布局降级。这条是 PM 最先指出的误伤，现在彻底没有。
> 这是对 PM 规则的一处补丁，不是推翻——**核心意图（手机上别做录入）完整保留**。PRD v1.4 §10.1 已采纳。
>
> 再钉一句 PRD v1.4 加的边界：**`pointer` 只做体验降级，不是权限边界。** 权限永远由角色（admin / member）决定；`pointer: coarse` 只决定"这一版界面给不给编辑入口"。换句话说，**禁止把 `pointer` 判断写进任何后端鉴权、也禁止用它来隐藏本应可见的数据**。一个 iPad 上的 member 仍然是 member，一个窄窗口的 admin 仍然是 admin。

#### 移动与窄屏（PRD §11.4 · v1.2 从 P1 提到 **P0**）

**三个页面 + 一个共用模板**

| # | 路由 | 内容 | 为什么必须有 |
|---|---|---|---|
| **M1** | `/q/:id` **登录态** | 报价单详情：单列，客户 / 活动 / 日期 / 分组明细 / 对客合计。成本与毛利放进「内部信息」折叠区，**默认收起**（手机上多数场合是给客户或老板看屏幕） | 老板在饭桌上问"这单多少钱，毛利多少" |
| **M2** | `/materials/:id` | 物料价格详情 + 比价结果：主体信息 → 摘要条（同口径可比 N 家）→ **按交易性质分 Tab → 卡片单列堆叠**（1 列，248px 下限失效，卡片全宽） | **PM 点出的那个场景**：项目经理在现场要查"这个桁架哪家多少钱" |
| **M3** | `/staff/:id` | 人员价格详情，复用 M2 模板（Tab 换成 `unit_mode`） | 现场临时换主持人要现查价 |

- **我把 PM 列的"比价结果（单列堆叠）"并进了 M2**，理由：手机上多一层跳转就是多一次迷路，而 M2 往下滚本来就是单列堆叠的比价结果。若 team-lead 坚持要独立页，加一个 `?compare=1` 状态即可，成本很低——**先做合并版，不够再加。**
- **客户 Q4 答复：手机查价不是刚需 → 移动端只做只读，三档保留，但不再为它独立设计版式。**（team-lead 已裁决批准）三页**不各画一套线框**，统一标注：**复用对应桌面详情页的单列布局，不独立设计**。具体做法：
  - M1 = 桌面报价单详情页去掉编辑能力、`aside` 折叠进「内部信息」、明细表降为单列卡片；
  - M2 / M3 = 桌面比价页去掉数量档切换（固定按主体默认数量）、卡片区从 `auto-fill` 变 1 列、Tab 变横向滚动条；
  - **不新做组件、不新做图**。仅有的移动专属件是：底部只读提示条、`复制链接` 按钮、Tab 横向滚动条。
  - 这条让移动端投入从"3 个页面设计"降到"3 处降级规则"，**省下的工时应该花在比价页和报价单编辑器上**——那两个才是差异化。
- **路由必须是登录态 `/q/:id`，不是 `/q/:token/view`（PM 明确否掉，team-lead 升级为项目红线）**。免登录 token 一旦被转发，等于把客户名 + 报价金额送给任意第三方，而且无法追溯——价格是这家公司最敏感的数据。这也符合 PRD 的 Out-of-Scope（不做客户自助查看）。
- 手机上**不做**：录入、编辑明细、拖拽排序、命令面板、批量操作。**做半成品比不做更糟**——用户试一次失败，会顺手认为整个产品不行。
- **只读态必须说明原因，不许只是按钮消失**（PRD v1.4 §10.1 硬要求）。规则：**凡是"本该有、却不见了"的控件，位置上要留一句话。**
  - 报价单详情页底部固定一条 44px 提示条：`手机上只能查看，改价请在电脑上操作` + 一个 `复制链接` 按钮（他多半是想转发给有电脑的人）
  - 明细行的编辑入口不渲染，但表头右侧常驻 `只读` 灰徽章
  - 这样处理跟"不直接阻断"是同一条逻辑：**让人以为系统坏了，比让他换个设备更糟。**

**移动端视觉参数（与桌面同一套 Token，只换排版比例）**

| 项 | 桌面 | 移动 |
|---|---|---|
| 正文 | 13–14px | **15px** / 行高 1.6 |
| 卡片间距 | 16px | 12px |
| 页面左右边距 | 24–32px | 16px |
| 点击目标 | ≥28px | **≥44×44px**（WCAG 2.5.5，拇指是圆的） |
| 底部操作条 | 60–64px | 56px + `env(safe-area-inset-bottom)` |
| 摘要条 | 44px 两行 | **不压缩**，仍是两行（这是结论，不能因为屏幕小就砍掉"同口径可比 N 家"） |
| 表格 | 13 列表格 | **一律不进表格**，改 key-value 列表（`成本单价  ¥3,200`） |

**垂直空间预算（768 高的笔记本是真实痛点）**
- 比价页、报价单编辑器两屏都采用「**中间区独立滚动 + 顶栏与底部操作条吸边**」的结构，页面本身不出现纵向滚动条。
- 报价单编辑器：顶栏 52 + 单头信息 64 + 明细区 flex（约 528）+ 汇总条 60 + 边距 64 = 768。
- 任何新增的横向工具条，都要先从这 768 里预算出空间，不允许"挤一挤就有了"。

### E.6 无障碍

- 所有交互元素 `:focus-visible` → 2px `--accent` outline + 2px offset，**永不 `outline: none`**。
- 图标按钮必须有 `aria-label`（如 `aria-label="删除这一行"`）。
- 表格用语义 `<table>` + `<th scope="col">`，行选中用 `aria-selected`。
- 颜色不单独承载含义：最低价有"最低"文字徽章，毛利为负有负号与 `triangle-alert`，过期有"187 天"数字。
- 数字使用 `aria-label` 补全单位：屏幕阅读器读 `四百五十元每根每天` 而不是 `45`。
- 触摸目标（虽然桌面为主）：可点击图标至少 28×28 命中区（用 padding 撑，不改图标尺寸）。

---

### E.7 三个指标的口径（给前端埋点 / 给架构师定字段）

> PM 在 PRD §12.1 定了口径，我把它落成"界面上怎么体现"，因为口径错了界面一定跟着错。三个指标，别混。

| 指标 | 定义 | 目标 | 界面上的体现 |
|---|---|---|---|
| **`has_overdue_price`** | 本单是否存在 `cost_source = price_book` **且该价格硬失效**的行 | **= 0（硬性红线）** | 情形 B 的红色行。**手填成本（情形 D）不计入** |
| **`manual_cost_line_ratio`** | 手填行数 ÷ 总行数 | 4 周 < 30%，3 个月 < 10% | 汇总条的 `1 行手填` 灰字；设置页不展示，进内部数据看板 |
| **`price_match_failed`** | 出单时匹配不到可用价的次数，带 `reason`（`no_price` / `all_expired`） | 递减 | 情形 A/B 的行内红字与埋点属性 |
| **`manual_cost_reason`** | 手填成本**为什么**手填，两值：`no_price` / `all_expired`（真缺价）vs **`found_but_not_used`**（库里有价，人没找到/没用） | — | 手填那一刻的埋点，见下 |
| **`found_but_not_used` 占手填总量** | 库里有可用价、用户却手填了的比例 | **< 20%** | 内部看板；这是**唯一与录价权限无关**的界面质量指标 |

> **为什么手填率必须拆成两种原因（PM 的 12.1.1，我认为这是本轮最实用的一条）**
> 一个笼统的「手填率 45%」会让团队默认"是体验问题，去优化录价表单"——**而如果是权限问题，优化表单毫无用处；如果是体验问题，开权限也毫无用处。**
> 拆开之后：
> - `no_price` / `all_expired` 高 → **覆盖率问题**：录价权限（R15）、录价速度、冷启动。**不归界面管。**
> - `found_but_not_used` 高 → **体验问题**：搜不到、搜索词不对、不会用、不知道有比价。**这才是界面该背的。**
>
> **我的自检判据（也是给自己划的界）**：`found_but_not_used` > 20% → 我的问题，去改搜索与比价的可发现性；它很低但总手填率很高 → 权限问题，**别为一个不归界面管的问题优化界面**。一个不能指向对症动作的指标，等于没有指标。

- **为什么手填不算进 `has_overdue_price`**：手填成本**不是脏数据，是新库阶段正常且必要的兜底**。算进去的话首月必然 100%——**而一个首月就爆表的监控指标，团队会永久忽略它，连带把真正的过期价事故一起忽略。**
- 手填本身当然要盯，但它盯的是"库够不够用"，不是"数据对不对"。所以单独一个 `manual_cost_line_ratio`，那才是"价格库有没有真被用起来"的体温计。
- 三个指标都**不上界面做成 KPI 卡**（那是数据大屏套路，工作台已明确不做）。它们只进内部看板与验收报告。

## F. 给前端 Agent 的实现提示

1. **先接 Token，再写组件**：`import tokens from '@/design-system/design-tokens.json'`，CSS 走 `design-tokens.css`。组件里出现 `#` 开头的颜色即视为 bug。
2. **数字单元格必须套 `.num` 类**（`tabular-nums` + 右对齐 + `nowrap`）。实测 `font-variant-numeric` 是否生效——把 `font-family` 里的 Inter 去掉看对齐是否变化，若不变说明没生效。
3. **金额格式化统一走一个函数**：`formatMoney(v, { decimals: 2, symbol: false })`，禁止各页面自己 `toFixed(2)`。负数用 `\u2212`。
4. **表格用 TanStack Table**（列固定、列显隐、排序），**不要用现成 heavy grid**（AG Grid 的默认皮肤会把 Token 全覆盖掉，改造成本高于自建）。
5. **行编辑不要用受控全表 re-render**：单行用局部 state + `useDeferredValue`/memo，否则 30 行 × 13 列每敲一个字符重算全表会掉帧。
6. **快捷键统一 hook**（`useHotkeys`），并做"焦点在 input/textarea/contenteditable 时不触发单字母快捷键"的守卫——否则用户打备注时会狂建报价单。
7. **冻结列实现**：`position: sticky; left: 0; z-index: 2; background: var(--table-sticky-col-bg)`（背景必须不透明）+ 滚动容器上加 `overflow-x: auto`。表头冻结 `position: sticky; top: 0; z-index: 3`。
8. **密度切换**：在 `<html data-density>` 上切，靠 CSS 变量联动，不要在 JS 里传 30 个 props。
9. **图标统一 import 自 `lucide-react@1.64.0`**，唯一出口 `src/components/icons.tsx`，锁定 `strokeWidth={1.75}`。架构文档 §11.2 R3 已用 ESLint `no-restricted-imports` 兜底：除 `icons.tsx` 外任何文件 import `lucide-react` 直接构建失败——**这条不靠人记，靠 lint 拦**。
10. **别加 loading spinner 满屏**——用骨架屏，行高与真实行一致，避免 CLS。
11. **只读模式的判定必须带设备**：`const readonly = width < 1024 && matchMedia('(pointer: coarse)').matches`。只判宽度会让拖窄窗口的桌面用户莫名失去编辑能力（§E.5）。
12. **折算价永远由后端给**：拿 **`base_unit_price`** 直接渲染（架构 §: `normalized_price` 这个名字没采用），前端**不许出现 `unit_price / base_unit_qty` 或 `* base_unit_qty`**。方向搞反过一次就会亏钱，而且没人看得出来。
13. **危险按钮底色用 `--danger-fill`，不要用 `--danger`**。`--danger` 是文字族，拿它当底色就是把「后果」和「行动」两种语义搅在一起，形态隔离就失效了。
14. **数量的 `qty` 状态在卡片视图与表格视图之间共享**，切视图不重置；但**交易性质 Tab 的切换也不重置 qty**——同一个数量在租和买两种性质下都要看。
15. **计价方式有三个字段，别用错**（v1.7 钉死）：`prices.unit_code` 是**表单选项值**（短码 `day`/`session`/`person_day`，可写）；`prices.unit_mode` 是**分组与展示用**（带前缀 `per_*`，后端生成列、前端只读）；`items.pricing_mode` **只做表单默认值与列表展示，绝不参与比价分组**。**判断标准一句话：给「这一条价」分组读 `unit_mode`，给「这个主体」预填读 `items.pricing_mode`。** 拿主体的默认值去给单条报价分组，就会把「按场报 ¥2,800」的讲师归进「按人天」组和别人的 ¥1,500 一起标最低。另：`pricing_nature`（物料性质，落库）与上面三个是不同维度，别合并。
16. **金额一律用 `MoneyInput` + `decimal.js` 解析**，内部存字符串，**不用 JS `number`**。浮点在"明细加总 ≠ 合计"上一定会翻车，而这个 bug 在财务界面里属于事故级。架构 §3.2.1 已规划该组件。
17. **报价单状态判断只从 `src/domain/quote-status.ts` 导入 `canEdit / canIssue / canVoid`**，组件里禁止写 `status === 'issued'`（架构 §11.2 R11）。**状态只有 `draft` / `issued` / `void` 三个，客户 Q5 定死不做审批**——界面上不出现「待审批」「已批准」「提交审核」任何字样；出单后唯一的后续动作是「通知管理员」（§C.7），没有等待。
18. **图表用 recharts 3.10.1 的 `type="stepAfter"`** 画阶梯线——价格是分段常数（1–99 一个价，100–499 另一个价），用默认的线性插值会画出"中间价位"这种不存在的价格。
19. **`compare_state` 由后端给**（`comparable` / `converted` / `not_comparable`），前端不做单位比对。`not_comparable` 的行**必须渲染出来**（置底 + 琥珀提示），不许 filter 掉——"这一行存在但不参与比价"本身就是用户要的信息。
20. **附加功能失败不许污染主功能（通用条款，不只趋势图）**：趋势、迷你图、参考图缩略、外链预览、导出、通知未读数——**任何次要请求失败，都只在它自己的位置降级成本地一行 `没加载出来 · 重试`，不弹全局错误、不拦主流程、不置灰主按钮**。判断标准一句话：**主功能（看价、录价、出单）的可用性，不能依赖任何次要接口的成功。**
21. **`tax_basis` 是请求参数，`rows[].tax_included` 是响应属性，两者不许互相回填**（§C.4）。`GET /items/{id}/compare` 与 `GET /price-lookup` 的 `tax_basis` **必传**；拿 `rows[0].tax_included` 回填切换器的写法必须 review 掉——它在第一个供应商上碰巧正确，第二个就静默按错口径比。
22. **含税口径的值是码不是中文**：`quotes.tax_statement` / `app_settings.tax_statement_default` 存 `inclusive` / `exclusive`；出单时 `tax_basis = quotes.tax_statement` **同名同值域直接透传，零映射**。中文只在渲染层出现（`inclusive` → 「以上报价为含税价，税率另计」）。**禁止在提交前做中→英映射。**
23. **`lowest_summary` 多行渲染禁止取 `groups[0]`**：`is_multi_group === true` 时必须逐组出多行（列表页 / 抽屉 / chips 5 处一致）。这是"看起来跑得通、实际给出错数"的典型，且列表页没有 Tab 兜底（§C.3）。
24. **比价降级文案只认 `reason` + `basis_dimension`，精确匹配，不做字符串前缀判断**。文案表放 `src/domain/compare-reason.ts`（与 `quote-status.ts` 同级），未命中的 `reason` 退回兜底文案，不白屏不抛错（§C.4）。
25. **价格写权限是两个函数，不是一个**：`canCreatePrice(role)`（`POST /prices`，member 放行）/ `canOverridePrice(role)`（`PATCH`、`archive`、`refresh-prices`、删主体、删供应商，仅 admin）。**禁止合并成 `canEditPrice` 再内部分支**——一合并就会出现"member 点新建被连带禁用"的反向 bug（§C.7）。
26. **`unit_mode` 只有 5 个值 + `NULL`**，没有 `per_sqm` / `per_sheet`。非时间类单位一律 `NULL`，`unit-mode.ts` 码表 5 项，**非时间类不生成 label**；渲染时 `unit_mode IS NULL` 退回 `unit_code` 的中文，不拼"按㎡"。自己编一个 `per_*` 会让分组按单位分裂，还会让物料行的 `null` 匹配不上、价格整批被过滤掉（§C.4）。
27. **`other_basis_price` 永远不进成本框，而且只在 422 里取**。`/price-lookup` 在该口径无价时**不回退换价**：`200` 是 `PriceLookupResult`（**不含** `other_basis_*`），`422 / code=42205` 才是 `PriceLookupMiss`，`other_basis_exists` / `other_basis_price` / `other_basis_tax_included` / `other_basis_price_id` 都在这里面。所以提示条只能写在 **422 分支内**，写成「`res.data.other_basis_price` 有值就显示」会永远拿到 `undefined`——不报错，只是提示永不出现。含税与否读 `other_basis_tax_included`，**不从 `tax_basis` 反推**；跳转用 `other_basis_price_id`，**服务端不据此计算、前端也不拿它二次查价**；文案里的主体名与口径名用错误体回显的 `item_id` / `supplier_id` / `pricing_nature` / `tax_basis` / `on_date` 查字典，**不拿请求参数自己拼**。文案只能是「请让供应商补报，或手工填成本」，**禁止「已自动采用」**（§C.4B）。`refresh-prices` 的 `dry_run` **必传无默认**，界面必须两态（预览清单 → 写入），`include_manual` 默认不勾（§C.4B）。
28. **`warn_rate_used` / `warn_rate_source` 直接渲染，不在前端反推**。汇总条那句话后面标 `按项目类型` / `默认`；反推等于把 5 个类型的配置在前端再算一遍，会造出第二个真相源（§C.7）。
29. **`42205 NO_VALID_PRICE` 与"主体没价"必须分开提示**：前者是"问过、但这家的这个口径没价"，后者是"压根没问过"。两句混用会把补救动作教错（§D.5）。

---

## G. 设计自检清单（交付前逐条过）

**v1.3 与 01a 验收用例（TC-1 ~ TC-15）的对齐核对**

- [x] TC-1 阶梯：断档回退 PriceBook 单价并告警不阻断（TC-1.10）；重叠录入警告但允许保存、取价按 `min_qty` 降序（TC-1.11）；低于 `moq` 卡片降灰不可选（TC-1.7）
- [x] TC-2 折算：乘法不是除法（TC-2.1/2.9）；未折算行**渲染出来但置底不参与最低价**（TC-2.3/2.5/2.7）；双层显示折算价与原价（TC-2.6）；`base_unit_qty` 填 1 拒绝、填小数提示单位选反、可空无默认（TC-2.10~2.13）
- [x] TC-3 交易性质：Tab 分段、默认选行数最多的组（TC-3.6）、单一性质不显示 Tab（TC-3.7）、**无跨组最低价**（TC-3.5）
- [x] TC-4 税口径：含税/不含税可并存，比价一次只在一个 `tax_basis` 内比（TC-4.1~4.6）；跨口径不标并列（TC-4.7）；口径来源取本单声明，用户零操作（TC-4.8）
- [x] TC-4C 切换口径的提示：**给整单合计前后值**（4C.2）、区分自动/手工定价行（4C.3）、预告缺价行（4C.4）；缺价行**对客价保持原值不清零且仍计入合计**（4C.6/4C.8）；N=0 不弹窗（4C.7）；切换响应 150ms 与改数量同级（4C.9）；值存码不存中文（4C.10）
- [x] TC-4D 自有人员：`internal` 类型单价下**固定提示「这是内部成本折算，不是对外支付」**且一眼可见（4D.2）；比价卡片显式区分「自有 / 外聘」（4D.4）；自有成本不与外聘直接比出结论
- [x] TC-5 价格状态：四级 + `max(updated_at, last_used_at)`；恰好 90 天算有效（TC-5.6）、91 天起陈旧（TC-5.7）；软陈旧参与比价可出单（TC-5.8/5.9）
- [x] TC-5B `pricing_mode` 派生不落库、5 值、须带 `item_type` 判断（TC-5B.1~5B.4）
- [x] TC-7 毛利率：分母是报价合计（TC-7.5）；系统内不出现加成率那一个数（TC-7.6），但**常驻显示换算 `≈成本 × 1.667`**（v1.4）；对客合计为 0 时显示 `—`（TC-7.10）
- [x] TC-8 自检：7 warning + 1 blocker（客户名）；**只有客户名阻断 `issue`，草稿不阻断**（TC-8.5/8.6）；全不命中不弹窗（TC-8.4）
- [x] TC-9 出单阻断：`disabled` 只看「有没有成本」，填完立即启用（TC-9.1/9.2）；手填不计入 `has_overdue_price`（TC-9.5）
- [x] TC-10 按旧价重新录价：文案、版本化行为、`last_used_at` 同步（TC-10.1~10.5）
- [x] TC-11/13 快照与状态机：`issued` 后**只读**，只能复制重报（TC-13.2）；三态无「已成交」（TC-13.1）
- [x] TC-12 导出边界：`member` 不得导出内部版（TC-12.7）；客户版独立 DTO 不是 flag（TC-12.6）；隐藏行整行剔除（TC-12.1）；客户版零「成本/cost/毛利/profit」（TC-12.2）；预览态每次重置（TC-12.8）
- [x] TC-14 权限矩阵：录价 / 改价 / 导出内部版 = 仅 admin；屏幕看成本 = 都可
- [x] 图标库 `lucide-react@1.64.0`（架构 §3.2.1 核实）；线框图符号全部 ASCII

**v1.2 与 PRD v1.2 的一致性核对（8 项改动，逐条对上）**

- [x] **① 交易性质分段** —— §C.4 改为 `pricing_nature` Tab（>1 种才渲染）+ §D.1C 组件规范；人员复用同一组件渲染 `pricing_mode`
- [x] **② 摘要条文案** —— §C.4 重写：金额/百分比二选一、`同口径可比 N 家`、线上/线下、N=0/1/2/≥3 四种文案
- [x] **③ 阻断逻辑** —— §C.7 明确"填了成本即启用"，负毛利不阻断，并给了那一行伪代码
- [x] **④ 按旧价重新录价** —— §C.7 新增按钮 + 版本化行为 + 10 秒撤销 + 与手填的区别表
- [x] **⑤ 朱砂/危险红形态隔离** —— §B.2 + §B.2.1：形态隔离三规则、L\* 差 18.98、10 组对比度实测表
- [x] **⑥ 折算第 2 级** —— §D.1.1「折算价（双层）」+「未折算（降级态）」；换算问句「1 ㎡ = 多少张？」进 §C.4B
- [x] **⑦ 清空规则精确化** —— §C.4B 逐字段表，**单位必须清空**，并写了理由
- [x] **⑧ 移动端** —— §E.5 三级边界（≥1024 完整 / 375–1023 只读 / <375 提示）+ 3 个页面 + 登录态 `/q/:id` + P0

**v1.6 与 PRD v1.7 / 架构信 3 / 客户 Q2·Q4·Q5·Q7 的一致性核对（13 项，逐条对上）**

- [x] **① 整单合计前后值** —— §C.7 切换提示给 `¥13,166.67 → ¥12,308.33`（18px/590）+ 自动/手工定价行区分 + 缺价行预告
- [x] **② 缺价行不清零且仍计入合计** —— §C.7「缺价行的对客价保持原值，不清零」+ 写明理由（商务判断 vs 数据问题）
- [x] **③ 「不报错的错误才是危险的」** —— §A.3 第 5 条，并列出本产品五处适用点
- [x] **④ `tax_basis` / `tax_included` 分工** —— §C.4 对照表 + F.21；切换器值只来自请求参数
- [x] **⑤ `tax_statement` 存码不存中文** —— §C.7 字段表 + 两句声明中文 + F.22
- [x] **⑥ `reason` 枚举改名 + `basis_dimension`** —— §C.4 降级原因表 + `compare-reason.ts` + F.24
- [x] **⑦ Tab 维度 = 交易性质 + 计价方式** —— §C.4 Tab 表「分段维度」行，三种情形写全
- [x] **⑧ `lowest_summary` 多行** —— §C.3 三条规格 + 5 处适用范围 + 线框重画；F.23 禁止 `groups[0]`
- [x] **⑨ `internal` 提示与徽章** —— §C.4B「这是内部成本折算，不是对外支付」+ §D.1.1 `自有` 徽章
- [x] **⑩ 工作台 5 字段** —— §C.2 对照表，`is_overwrite` 单独处理，`manual_cost_line_ratio` 不上首页
- [x] **⑪ 移动端复用不独立设计** —— §E.5 三条降级规则 + 移动专属件清单
- [x] **⑫ 阶梯 placeholder 按性质** —— §C.4B 客户 Q2 段落
- [x] **⑬ 附加功能失败不许污染主功能** —— §F.20 通用条款
- [x] 客户 Q7 默认含税 —— §C.7 `tax_statement` 默认 `inclusive`；Q5 无审批 —— §C.7 自检弹窗不变

**v1.7 与 PRD v1.8 / 客户 Q2·Q3·Q4·Q5·Q6·Q7 / R15 定案 的一致性核对（14 项）**

- [x] **① 人员比价分组基准改为 `unit_mode`** —— §C.4 Tab 表新增基准行 + 反例（按人天备案、按场报 2800）；`items.pricing_mode` **不参与分组**
- [x] **② 三个计价字段分工** —— §C.4 三字段对照表 + 两张码表（`unit-code.ts` / `unit-mode.ts`）+ F.15 重写
- [x] **③ 组内只有 1 家不标最低** —— §C.4 Tab 表 + §C.3 列表页
- [x] **④ 主体默认与单条不一致不报警** —— §C.4「合法现实」行 + §C.5 人员库一行
- [x] **⑤ 附件：客户版只带物料图** —— §C.7 导出菜单新增 `客户版不含供应商报价附件（3 张）`，0 张不渲染
- [x] **⑥ 附件不物理删除** —— §D.5 删除确认文案改写，全篇不出现「彻底删除」
- [x] **⑦ SVG 不进白名单** —— §C.7 `accept` 显式四值 + 前端二次校验 + 服务端第三次
- [x] **⑧ 403 文案** —— §D.5 两条（覆盖价 / 改性质），都说清「你可以新建一条」
- [x] **⑨ 413 / 415 文案** —— §D.5 给出实际大小与支持格式
- [x] **⑩ R15 = 分层开放** —— §C.9 权限表重排（新建一条价 成员可）；新增 §C.7「新建一条价」动作规范（命名、预填、只放开单价+生效日、Toast 写明旧价结束）
- [x] **⑪ 项目类型下拉 + 按类型阈值** —— §C.7 新增下拉规范 + 着色文案带类型名；设置页 6 项之第 1 项改为 5 类型 + 默认，留空回退
- [x] **⑫ 阈值只改颜色不禁用** —— §C.7 项目类型表「只改颜色与自检提示」行 + §C.9 变更风险列
- [x] **⑬ 交易性质按分类预填、人员无此字段** —— §C.4B 按 `item_type` 分叉，两个下拉不同时出现
- [x] **⑭ 导出声明默认含税、切换方向不写死** —— §C.7 字段表 + 方向由 `from`/`to` 拼；Q5 无审批 → F.17 删掉「将来加审批态」暗示

**PM 点名的 P0 铁律**

- [x] 全文无 emoji 作功能图标（图标全部来自 Lucide **v1.64.0**，§B.8 有 48 条映射表；线框图的三角、对勾类几何符号已全部换成 ASCII `>` `v` 与文字，避免纯文本环境下渲染成豆腐块）
- [x] 无紫色→粉色渐变（主色墨 `#14181D` + 朱砂 `#D2431F`，全文零 `linear-gradient`）
- [x] 无空洞占位文案（示例全是"桁架 3m 方管""张启明（主持人）单场 4 小时"这类真实行业内容）
- [x] **不得因换墨黑而降低密度** —— 行高 36px / 表格 13px / 明细 13 列，写进 §A.4 当硬底线
- [x] **朱砂不与危险红同形态层级** —— token 层物理隔离（`--accent` 填充族 / `--danger` 文字族 / `--danger-fill` 唯一例外）

**设计系统**

- [x] 所有颜色走 Token，CSS + JSON 双份可直接用；组件里出现 `#` 即视为 bug
- [x] 间距全为 2/4/8/12/16/20/24/32/40/48/64（4px 网格）
- [x] 字体 Inter + Noto Sans SC + JetBrains Mono 三层分工明确
- [x] 数字排版有 `tabular-nums` / 右对齐 / 小数位 / 货币符号 / 负号规则（§B.7）
- [x] 组件状态覆盖 default/hover/focus/active/disabled/loading/error/empty + 比价卡片四态（§D.1.1）
- [x] 三级响应式边界 + 只读模式的判定条件（宽度 + 输入设备）

**质量标准**

- [x] **对比度 10 组实测**（§B.2.1），唯一不达标的一组（朱砂字/纸白 4.33）已改为"禁止组合"并给替代方案
- [x] **朱砂 vs 危险红 L\* 差 18.98 ≥ 18**，深色皮肤 20.92 ≥ 18（方向相反）
- [x] 动效 ≤260ms，支持 `prefers-reduced-motion`
- [x] 键盘可达：全局 15 个快捷键 + 表格完整位移模型 + Tab 组件的方向键归属规则
- [x] 危险操作三级分级（L0/L1/L2），L2 要求输入名称确认并列出影响面
- [x] 空/加载/错误态均为具体业务文案，无"暂无数据"
- [x] 三个指标口径写清（§E.7）：`has_overdue_price` 不含手填 / `manual_cost_line_ratio` 单列 / `price_match_failed` 带 reason

**给架构师的交接项（缺一个前端就做不对）**

- [ ] 比价接口直接返回 `base_unit_price`（折算后），前端只展示不算除法
- [ ] `PriceBook.base_unit_qty`（可空）+ `PricedItem.compare_unit` + `default_pricing_nature`
- [ ] `QuotationLine.cost_source` enum（`price_book` / `manual`）+ `reference_lowest_price` + **`reference_lowest_supplier_id`**（没有它答不了「本可选 3 家、你选了第 2 家」）
- [ ] `Supplier.type` 固定 5 值枚举码（`online / factory / rental / freelancer / internal`），界面文案映射见 §C.6
- [ ] 比价接口返回：`tier_breakpoints[]`（档位并集）+ `groups[].rows[].tiers[]`（完整阶梯）+ `compare_state` + `base_unit_price` + `missing_suppliers[]`；**没有全局 `lowest_price` 字段**（留了就早晚有人用）
- [ ] `CustomerQuoteDTO` 独立（不含 `cost_*` / `margin_*`），导出渲染函数只接受它
- [ ] 表格用 TanStack Table 8.21.3（不用 AG Grid，其默认皮肤会覆盖全部 Token）；金额输入用 `MoneyInput` + `decimal.js`
- [ ] `/q/:id` 为登录态路由，不提供任何免 token 的公开访问路径
- [ ] `pricing_nature`（落库）与 `pricing_mode`（派生不落库，带 `item_type` 判断）是两个字段，别合并

---

## H. 待确认事项

### 已由 PM 在 PRD v1.2 拍板（本节保留是为了留痕，不需要再答）

| 原问题 | 结论 |
|---|---|
| 主色：墨+朱砂 vs 藏青 | **采纳墨+朱砂**，并加了形态隔离与 L\* ≥18 两条硬约束（PRD §11.6） |
| 是否拆两级过期（软陈旧/硬失效） | **采纳**，且软陈旧计时起点改为 `max(updated_at, last_used_at)` |
| `has_overdue_price` 是否含手填 | **不含**，另立 `manual_cost_line_ratio` |
| 成本默认取哪个价（R3） | **两个值都记**：`cost_unit_price` + `supplier_id` + `reference_lowest_price` |
| 含税双口径（R4） | **不做开关**，改一行口径声明 |
| 移动端 | **P0，三页，登录态 `/q/:id`** |
| 审批流（R13） | **不做**，改发送前自检（不阻断） |
| 分类命名（R14） | **两棵树各 8 类**，不设「其他」 |
| 单位换算（R9） | 采纳 `base_unit_qty`（不叫 `conversion_factor`） |

### 仍需答复（Phase 1 冻结时只剩阈值真值）

1. ~~R15 录价权限~~ → **已关闭（客户选 c，分层开放）**：`member` 能新建价格、不能覆盖/停用已有价格、不能改交易性质与折算系数。设计已按 (c) 坐实：§C.9 权限表重排、「新建一条价」成为 member 唯一的"改价"路径（§C.7），`member` 看到的不是 `编辑` 而是 `新建一条价`。
   - 这条最终能落到这个结论，靠的是 PM 那句风险对比：**手填成本是"没有记录、无法追溯、无法纠正的错数"，录进库的错价至少是"有记录、有署名、可被下一条覆盖"的**。在成员已经能手填的前提下，禁止他录价，风险反而更大。
   - 落地时唯一要守住的是**动作命名**：叫他「新建一条价」，他就不会以为历史被覆盖；叫他「改价」，他会一边新建版本一边以为旧的没了。
2. ~~移动端第 3 个页面（比价结果）要不要独立~~ → **已关闭**：team-lead 裁决**并入详情页**（客户 Q4 答"不是刚需"）。「比价结果」作为 `?compare=1` 的状态存在于 M2/M3，不单独设计版式。
3. **两个阈值仍需客户真值（R11 / Q3）**：软陈旧阈值 **90 天**；毛利率阈值现在是**按项目类型 5 个值 + 一个默认 25%**，5 个类型的具体数字仍需客户给。都是设置项，写代码不用等；**但上线前必须确认**，否则第一次预警就误报或漏报，用户会把整个提醒机制关掉。
4. ~~Q6 分类命名~~ → **已关闭**：客户确认 8 + 8 两棵树照用。

> **Phase 1 冻结说明**：其余跨角色意见已转入 `docs/decisions/OPEN-DECISIONS.md`（OD-05 `pricing_mode` 码定稿 / OD-06 自有人员成本无维护入口 / OD-07 摘要条第 2 行退化），本文件不再迭代，Phase 2 设计细化时再开。

### 已自行拍板（PM 交给我定的，留痕）

- **`readonly` 只判 `pointer: coarse`，不判宽度**（PM 让我定）：加 `width < 1024` 前缀会让「iPad 横屏 1200px + 触摸」变成可编辑，而用指头在 13 列表格里改价是另一种难用；接键盘时浏览器自己会把 `pointer` 变成 `fine`，不用我们兜。
- **`charge_mode` 这个名字废掉，统一 `pricing_mode`**（PM 建议，我同意）：`pricing_nature`（物料）与 `pricing_mode`（人员派生）是同一套机制的两个实例，不新增第三个概念名，区分靠 `item_type`。
- **内部版导出加「参考最低价 / 高于最低价」两列**：与现有导出布局**不冲突**——屏幕那套"一格两行"本来就没有继承到导出模板，导出是从内部 DTO 重新渲染的平面文档，加列只是模板多两个 `<th>`。

### 我给 PM 的两条"设计上做了折中"的说明（不是问题，是备忘）

- **朱砂不能当文字色**：硬约束"朱砂只做填充 + 白字 ≥4.5"把它锁死在 L\* 49.27，于是它在纸白上做文字只有 4.33:1。我没有另造第三种红，而是**禁止这个组合**，链接走 `--link-fg`（5.04:1）。这样红族只有两个角色：一个填充、一个文字，比加一个 5.5:1 的"中间红"更干净。
- **`supplier_id` + `reference_lowest_price` 做成一格两行**：多一列会让 1366 出现横滚（1192 > 1102），违反 P0 硬线。两个值一个没少，只是没多占一列。

---

## I. 附录 · 与 DESIGN.md 9 节标准的映射

本文件即项目设计契约（前端 Phase 3 的唯一设计依据），内容与 DESIGN.md 9 节标准一一对应：

| DESIGN.md 9 节 | 本文件对应章节 |
|---|---|
| 1. Visual Theme & Atmosphere | A.1 竞品调研 / A.2 对标品牌 / A.4 视觉基调 |
| 2. Color Palette & Roles | B.1 灰阶 / B.2 品牌与语义 / B.3 表格专用色 / B.9 CSS 变量 |
| 3. Typography | B.4 字体与字号 / B.7 数字排版规范 |
| 4. Components | D.1–D.4 关键组件 / D.5 状态文案 |
| 5. Layout & Spacing | A.5 信息密度策略 / B.5 间距 / B.6 圆角 / C 全局外壳 |
| 6. Depth & Elevation | B.6 阴影与 z-index / B.9 层级变量 |
| 7. Do's & Don'ts | A.3 五条原则 / G 设计自检清单 |
| 8. Responsive & Accessibility | E.5 三级响应式与移动端 / E.6 无障碍 / E.7 指标口径 / D.5 状态覆盖 |
| 9. Agent Implementation Guide | B.8 图标映射 / B.10 JSON / B.11 Tailwind / F 实现提示 |

机器可读产物：
- `design-system/design-tokens.json` （W3C DTCG 格式，前端 import 用）
- `design-system/design-tokens.css` （CSS 变量，含浅色 / 深色 / 三档密度）

---

## J. 品牌与文案规范（「有底」）

> PM 定名「有底」，报价单模块的内部动作叫「攒单」。界面语气要求：**克制的、说人话的、像中国办公室里的口语**，不要硅谷那套。

### J.1 名字怎么用

| 位置 | 用法 | 不要写成 |
|---|---|---|
| 侧边栏 Logo 区 | `有底`（两字，16px 590，字距 0.04em） | `有底 · 活动报价管理系统` |
| 浏览器标题 | `有底 · 物料库` | `有底系统 - 物料库 - 首页` |
| 登录页 | 大字 `有底` + 一行小字说明 `公司价格底账。报价前先看一眼。` | `欢迎使用有底报价管理系统 V1.0` |
| 侧边栏报价单入口 | `攒单` | `报价管理` / `报价单管理` |
| 攒进报价单的按钮 | `攒进报价单` | `添加至报价单列表` |
| 空单引导 | `单子还是空的` | `暂无报价单数据` |
| 报价单列表页标题 | `报价单`（导航叫攒单，页面叫报价单——因为页面上要放单号、客户、金额这些"单"的属性） | — |

> 一个品牌名出现在界面上不需要反复说。**除了 Logo 区和登录页，其它地方一律不出现"有底"三个字**，不写"有底提示""有底助手"这类衍生品牌词。

### J.2 语气三条

1. **动词开头，说清楚"点了会发生什么"。**
   `录一条价` / `攒进报价单` / `导出客户版` / `结束旧价`。
   不要写 `提交` `确定` `保存` 这种说了等于没说的词。

2. **说数字，不说形容词；但一个句子里只放一个数字口径。**
   写 `比最贵便宜 30%` 或 `比最贵便宜 ¥12.00`，**二选一**；× 不写 `比最贵便宜 ¥12.00（30%）`——括号里的 30% 读者不知道是"便宜了 30%"还是"占某数的 30%"，这就是一句看着精确其实含糊的话。
   写 `187 天没更新`，不写 `数据可能不及时`。
   写 `同口径可比 4 家`，不写 `多家供应商可供比较`。

3. **出错时说清"怎么办"，不道歉、不吓人。**
   写 `填个成本才能出单——估的也行，但别拿失效的价顶。`
   不写 `操作失败：价格校验未通过（ERR_PRICE_3001）`，也不写 `哎呀，出了点小问题～`。

### J.3 禁用词表（出现即改）

| 禁用 | 换成 |
|---|---|
| 赋能 / 抓手 / 闭环 / 打通 / 沉淀 / 对齐 / 拉通 | 删掉，直接说做了什么 |
| 一站式 / 全方位 / 智能化 / 数智化 / 提效 | 删掉 |
| 欢迎使用 / 欢迎来到 | 删掉，或换成当前该做的事（`上午好，今天有 4 件事`） |
| 暂无数据 / 暂无记录 / 空空如也 | `还没有录过物料价，先录一条试试` |
| 操作成功 / 提交成功 | `录好了` / `单子存上了` / `导出好了` |
| 确定 / 确认 / 提交（单独出现） | 用动词说明后果：`结束旧价` / `删掉这行` / `生成报价单` |
| 请您 / 亲 / ～ / ！ | 删掉。内部工具不需要敬语也不需要卖萌 |
| 系统提示 | `(!)` 图标 + 具体句子，不加前缀 |
| 该物料 / 该供应商 | `这个物料` / `这家` |
| 是否存在 / 是否确定 | `有` / `要`（问句直接用口语） |
| 加价率 / 加成率 | `毛利率`。系统内一律不出现加成率（PRD §6.6.5），两个数会打架 |
| 默认 / 通用 / 标准（单独作为配置项名） | 把默认值写出来：`25%` / `90 天` / `40%` |
| 该组 / 本组 / 当前分组 | `这一组`（指代要口语，不要公文） |

### J.4 数字与人名的写法

- 金额：`¥45.00`（¥ 与数字之间不留空格），千分位半角逗号，**永远 2 位小数**（单价也是，因为单价与金额要能对齐）。
- 天数 / 数量：整数不带小数点（`16 根`，不写 `16.0 根`）。
- 毛利率：`41.5%`（1 位小数）。
- 日期：相对时间优先（`今天 09:24` / `昨天 18:42` / `3 天前`），超过 30 天用绝对日期（`09-24` / `2025-03-11`）。**"187 天" 这种天数只在风险提示里用**，因为那个数字本身就是警告。
- 人名带岗位：`张启明（主持人）`，不带岗位的人名在报价单里会认不出是谁。
- 供应商名保留原样：`淘宝-喷绘之家`、`金桥桁架厂`——不加书名号，不做缩写。

### J.5 空、加载、错误的写作模板

```
空态   = 「还没 + 一个具体事实」+「先做这一件事」+ 主按钮（动词开头）
加载   = 「正在 + 拉什么」+ 数量（正在拉 4 家供应商的 47 条价格…）
错误   = 「哪里没成」+「为什么」（人话，不是错误码）+ 主按钮（重试/换个办法）
风险   = 「哪个对象」+「什么数值」+「会怎样」+ 两个动作（去做 / 我知道）
```

### J.6 视觉语气：为什么是"墨 + 朱砂"，而不是 PRD 建议的"藏青"

PM 建议按 `enterprise.md` 基线走深蓝/藏青主色。我最终选了**墨黑 + 朱砂**，理由三条，请评审时一并看：

1. **藏青 + 表格 = 满街的进销存后台。** 这套系统对外不展示、对内要用三年，它的"品牌"只剩一件事：让报价员觉得"这是我们公司自己的东西"。墨黑 chrome + 纸白表体 + 一处朱砂，气质上直接对应**报价单、报价章、红笔圈价**——这是报价员真实的工作物件；藏青对应的是"又一个管理系统"。
2. **藏青和"绿=有效价"在密表里会互相污染。** 冷蓝底 + 冷绿数字并排时，绿色会被削弱，而绿色在本系统里承担"最低价/正毛利"的最关键判断。墨黑是中性无彩，让绿和朱砂各自都跳得出来。
3. **朱砂本身就是橙色系**，替掉了 PRD 提出的"琥珀橙作警示"的角色分工——朱砂只做行动色，琥珀专心做风险提示，两者不再抢同一个语义槽。

**如果 team-lead 或客户坚持要藏青**：只需替换 4 个 token（`--ink` → `#1B3A57`、`--ink-hover` → `#234A6D`、`--sidebar-bg`、`--accent` → `#0E7490`），其余 241 个 token 不动，30 分钟可切。我把这个决定权交上去，但我的推荐是墨 + 朱砂。

### J.7 差异化视觉锤：一句话记住这一屏

比价页的摘要条要能做到"截图发到群里，别人一眼看懂"。PM 建议直接拿它当宣传截图，我同意——**它是整个产品最值钱的 44 像素**。

```
最便宜 ¥28.00 金桥桁架厂（线下定做厂）｜ 次低 ¥32.00 喷绘之家（线上电商）｜ 同口径可比 4 家
线上最低 ¥32.00（喷绘之家）｜ 线下最低 ¥28.00（金桥桁架厂），线下便宜 12.5%
```

它回答的不是"多少钱"，而是**"我该找线上还是找线下"**——这才是报价员心里真正的问题。这也是 PRD 里"同一个物料线上淘宝和线下定做厂价格差很大"那个困惑的直接答案。

**这三句话的每一段都在防一种骗人方式，不能删：**

| 段 | 防的是什么 |
|---|---|
| `同口径可比 4 家` | 只有 1 家可比时，"最便宜"是个假结论。这个数字让结论有了分母 |
| `（线下定做厂）` `（线上电商）` | 只说"金桥桁架厂最便宜"没用，用户要知道**该往哪个渠道找** |
| `次低 ¥32.00` | 只有一个"最便宜"时，用户无法判断这个最低是便宜的离谱还是就便宜一点点 |
| `线下便宜 12.5%` | 一个数字，一个口径。× 不写 `便宜 ¥4.00（12.5%）` |

> **反例（上一版我写错了，留在这里当反面教材）**：`最便宜 ¥28.00 · 比最贵便宜 ¥12.00（30%）`。它把金额和百分比并列，看着很专业，实际上读者要停下来想一秒——而在报价这件事上，让人停下来想一秒的文案就是失败的文案。

---

---

## K. 变更记录

| 日期 | 版本 | 变更 | 原因 | 影响范围 |
|---|---|---|---|---|
| — | v1.0 | 初版：墨+朱砂设计语言、241 个 Token、9 页线框、表格行式比价、报价单编辑器 | Phase 1 设计系统 | 全部 |
| — | **v1.1** | ① 品牌名对齐「有底」，报价单模块叫「攒单」 | PM 定名 | 全局文案 |
| — | v1.1 | ② **比价页从表格行式改为卡片式**，增加数量档切换器、类型标签、五重最低价编码、卡片内迷你趋势、顶部摘要条；保留表格视图作为切换 | PRD §7.2 指定形态；PM 强调"最低价必须第一落点" | C.4 全部重写 |
| — | v1.1 | ③ **新增 C.4B 录价抽屉**（4 必填 + 折叠 8 项 + 阶梯内联表 + 重叠内联确认 + 保存并再录一家） | PRD §7.1 生死线；上一版把它当次要动作是错的 | 新增章节 + 新增组件 |
| — | v1.1 | ④ 报价单编辑部：术语改「对客价/对客合计」、新增「不在客户版显示」行开关、双导出（客户版/内部版）、成本列服务端剥离硬约束 | PRD §7.3 + §11.3 | C.7 重写 + 交接约束 |
| — | v1.1 | ⑤ **缺价/过期价改为红色阻断 + 手填成本**，并区分 A/B（阻断）与 C/D（允许）四种情形 | PRD `has_overdue_price = 0` 验收线 | C.7 + D.5 + B.2 |
| — | v1.1 | ⑥ 语义色定稿为三级模型（绿占优 / 琥珀留意 / 红阻断），把"已失效"与"90 天未更新"拆成两级 | 采纳 PM 的严重度分级，但避免"满屏飘红" | B.2 |
| — | v1.1 | ⑦ 分类字典换为 PRD §6.5 的 6 类物料 + 8 类人员；侧边栏新增「嘉宾价」独立入口 | PRD §6.5 + PM 要求专业嘉宾别埋进演艺 | 导航 + C.3 + C.5 |
| — | v1.1 | ⑧ 响应式改为 1366×768 为 P0 硬下限（比价页 4 列不横向滚动）；<768 只做报价单只读视图 | PRD §11.4 | E.5 |
| — | v1.1 | ⑨ 空状态文案改为口语化（"还没有录过物料价，先录一条试试…"）；新增 J 品牌与文案规范（禁用词表 9 条） | PM 要求语气更土、更像办公室口语 | D.5 + J |
| — | v1.1 | ⑩ 单位换算改用单条价格记录上的可选 `conversion_factor`，不引入全局单位字典表 | 避免客户维护换算表；保住"4 个必填"承诺 | C.4 + C.4B |
| — | **v1.2** | ① **比价页引入交易性质 Tab**（`pricing_nature`，>1 种才渲染），**摘要条改为跟随选中性质**，砍掉上一版的"跨性质速览" | PRD §6.6.1：买断 ¥8,000 与租赁 ¥500/天 混一列标最低会直接造成亏损；PM 明确"Tab 必须在摘要条之上" | C.4 重写 + 新增 D.1C + 布局预算重算 |
| — | v1.2 | ② **摘要条文案重写**：金额与百分比二选一、加 `同口径可比 N 家`、N=0/1/2/≥3 四种降级文案 | PM：`便宜 ¥12.00（30%）`有歧义；只有 1 家可比时"最低价"是虚假权威 | C.4 + J.7 |
| — | v1.2 | ③ **阻断逻辑钉死为"未填成本才阻断"**，负毛利/软陈旧/非最低价一律不阻断，并给出前端可照抄的一行判定 | PM 标红：若"库无价即 disabled"，新库第一天就出不了单，产品首日即死 | C.7 重写 |
| — | v1.2 | ④ **新增「按旧价重新录价」**：把"用旧价"变成一条新建的价格记录（旧价 superseded），10 秒可撤销 | PM：手填的"刻意不方便"是对的，但要给一条出路，否则用户整单回 Excel | C.7 + D.5 |
| — | v1.2 | ⑤ **朱砂与危险红形态隔离**：朱砂只做填充、危险红只做文字；危险红 `#B42318 → #8C1A11`（L\* 49.27 vs 30.29，差 **18.98 ≥ 18**）；新增 `--danger-fill` / `--danger-on` / `--link-fg`；交付 **10 组对比度实测表** | PM 硬约束：同族红色只靠色相不可靠，必须形态 + 明度双隔离 | B.2 + 新增 B.2.1 + 两个 token 文件 + 深色皮肤重算 |
| — | v1.2 | ⑥ **折算价补第 2 级展示**（`¥60.00/㎡` 大字 + `原报 ¥5.00/张（1㎡ = 12 张）`小字）+ 未折算降级态；录价界面换算改问句「1 ㎡ = 多少张？」 | PM：原价必须看得见否则用户不信；问句天然消除乘除方向歧义 | D.1.1 + C.4B |
| — | v1.2 | ⑦ **「保存并再录一家」清空规则逐字段精确化**，**单位必须清空** | PM：不同供应商单位常不同，带错单位比多点一次鼠标危险得多 | C.4B |
| — | v1.2 | ⑧ **移动端 P1→P0，3 个页面，路由改登录态 `/q/:id`**（否掉免登录 token）；响应式改三级边界（≥1024 完整 / 375–1023 只读 / <375 提示） | PM：只给报价单页等于没解决"现场查价"；免 token 泄露客户名与金额且不可追溯 | E.5 重写 |
| — | v1.2 | ⑨ **分类拆回两棵树各 8 类**（物料 8 / 人员 8），不设「其他」，必须可增删改名；供应商类型定 5 值并改名（`淘宝店铺→线上电商`、`灯光商→灯光音响商`） | PM：上一版把「演艺人员」和「印刷物料」放同一棵树是结构错误 | C.3 + C.5 + C.6 + C.9 |
| — | v1.2 | ⑩ **明细表加 `supplier_id` + `reference_lowest_price` 快照**（视觉做成一格两行，因为多一列会让 1366 横滚）；毛利率行级不设阈值、25% 阈值可配 | PM R3：没有快照三个月后无法解释"这单为什么贵了"；行级阈值会天天误报 | C.7 + D.4 |
| — | v1.2 | ⑪ **含税口径改成一行声明**，不做双口径开关；新增设置页 6 个可配项 + 单位字典删除换算系数 | PM：会算错的开关比没有开关更糟；全局换算字典会造成"改一处全变" | C.7 + C.9 |
| — | v1.2 | ⑫ **发前自检第 3 条加"同性质 + 同税口径"两个限定** | 少了这两个限定，这条最有价值的自检会变成最危险的（劝人把买断价改成租价） | C.7 |
| — | v1.2 | ⑬ 新增 §E.7 三个指标口径（`has_overdue_price` 不含手填 / `manual_cost_line_ratio` 单列 / `price_match_failed`）；工作台「待处理」拆成软陈旧与硬失效两块，口径用 `max(updated_at,last_used_at)` | PM §12.1：首月就爆表的指标会被永久忽略 | E.7 + C.2 |
| — | v1.2 | ⑭ 报价单列表去掉「已成交」态；权限表拆成「录价 / 手填成本 / 改已有价格金额」三行 | PRD 只有 draft/issued/void 三态；手填成本是出单必需品，不能要求管理员 | C.8 + C.9 |
| — | **v1.3** | ① **`member` 不得导出内部版**（TC-12.7）：导出菜单该项置灰 + 常驻解释 `内部版含成本，仅管理员可导出`；权限表按 TC-14 重写（**录价 / 按旧价重新录价也改为仅 admin**，member 看到置灰 + `你可以先手填成本，这单照样能出`） | PM 发现权限洞：屏幕可见是即时行为，导出文件是可转发资产，风险量级不同 | C.7 + C.9 |
| — | v1.3 | ② **客户版是独立渲染路径，不是一个开关**（TC-12.6）：**删掉预览页的「隐藏成本与毛利」勾选框**，预览页只渲客户版；客户版模板只准出现「单价/数量/金额/合计」四个概念（TC-12.2） | 原设计本质仍是 flag 思维；客户版 PDF 检索「成本/cost/毛利/profit」必须 0 命中 | C.7 + C.8 重做 |
| — | v1.3 | ③ 「不在客户版显示」= **整行剔除、行数减少、分组小计重算**（TC-12.1），不是金额置零 | 留空行会让客户以为漏项 | C.7 |
| — | v1.3 | ④ **内部版导出必须有独立的「参考最低价」「高于最低价」两列**（屏幕那套一格两行不继承到平面导出） | 平面文档里「第二行跟着第一行」的位置关联，在筛选/复制/打印后不成立 | C.7 导出对照表 |
| — | v1.3 | ⑤ **税口径从「整组不标最低」改为「一次只比一个 `tax_basis`」**：含税/不含税价可并存（TC-4.1），比价只在选中口径内排序标最低，另一口径卡片置底仍显示 | 上一版把可解问题（选个口径）做成了无解问题（永远没有最低价） | C.4 + D.1.1 |
| — | v1.3 | ⑥ 自检扩为 **7 warning + 1 blocker**：客户名为空**阻断 `issue`**（草稿不阻断）；第 3 条加「同计价方式」限定 | TC-8.5：报价单是对外文件，没客户名就不是可发出的文件 | C.7 |
| — | v1.3 | ⑦ `issued` 后编辑器**只读**，主按钮改 `复制重报（生成 v2）`；毛利率分母为 0 显示 `—` | TC-13.2 / TC-7.10；快照不变性是对外报价的信任基础 | C.7 |
| — | v1.3 | ⑧ 人员计价枚举删 `按班 / 按项目`，统一 5 值 `按天/按场/按人天/按小时/按半天`；字段 `charge_mode → pricing_mode`（派生不落库） | TC-5B.2；枚举多一个值不是灵活性，是把可比性切碎 | C.4/C.5/C.8/C.9/D.1C/F |
| — | v1.3 | ⑨ 毛利率换算从 popover 改为**常驻显示** `(≈成本 × 1.667)` + 输入时两行换算说明 | PRD v1.4：会造成错误的那一瞬间就是他输入的那一瞬间，藏在弹层里的解释等于没有 | C.7 |
| — | v1.3 | ⑩ 折算格三项防错（填 1 拒绝 / 小数提示单位选反 / 可空无默认）；阶梯断档与重叠取值规则确定 | TC-2.10~2.13 / TC-1.10~1.11 | C.4B + E.2 + D.2 |
| — | v1.3 | ⑪ 图标库 `0.469.0 → **1.64.0**`；线框图的三角/对勾类几何符号全换 ASCII；新增 4 条实现提示（MoneyInput+decimal.js / quote-status.ts / stepAfter / compare_state） | 架构师核实 lucide v1 大版本；几何符号在纯文本环境下会变豆腐块 | B.8 + 全图 + F |
| — | v1.3 | ⑫ 移动端 `readonly` 采纳 `pointer: coarse`，并明确 **pointer 只做体验降级、不是权限边界** | PRD v1.4 §10.1 采纳我的补丁 | E.5 |
| — | **v1.4** | ① **含税口径从「页脚声明」提到「表单区的取价开关」**：分段控件二选一 + 改后全行成本毛利实时重算 + 切换前提示「当前有 N 行成本将变化」+ 举一个含税/不含税的真实价差；上一版写的「与比价完全无关」是错的 | PM §6.6.9：它是 `resolvePrice()` 的入参。做成装饰文字的后果是**毛利算高、报出去亏钱且不会报错**——最坏的一类错误 | C.7 重做 + 线框图 |
| — | v1.4 | ② `readonly` 改为**只判 `pointer: coarse`**，去掉 `width < 1024` 前缀；只读态必须给原因文案（`手机上只能查看，改价请在电脑上操作`），不许只是按钮消失 | PM 让我定。去掉前缀后 iPad 横屏 1200px 也是只读（用指头改 13 列表格是另一种难用）；接键盘时浏览器自己会变 `fine`，不用我们兜 | E.5 |
| — | v1.4 | ③ **多性质最低价列的适用范围扩到 5 处**：物料库列表 / 人员库列表 / 搜索结果 / 选品抽屉 / 工作台常用物料 chips | PM：列表页比比价页更危险——比价页有 Tab 提示，列表页没上下文，看到 380 就记一星期 | C.2 + C.3 + C.5 |
| — | v1.4 | ④ 字段名按架构对齐：`normalized_price → base_unit_price`、`QuotationPublicDTO → CustomerQuoteDTO` / `InternalQuoteDTO`、`item_type = 'personnel'`（不是 `person`）、`pricing_mode` 5 值补英文码；补 `reference_lowest_supplier_id`、`missing_suppliers[]`、`tier_breakpoints[]` | 架构已落进 Schema 与 openapi，前端照抄不返工 | 全局 + G |
| — | v1.4 | ⑤ **趋势图独立接口 + 异步两段式**：比价接口只出价格与阶梯，迷你图展开时才请求，先给 120px 固定高度骨架（防 CLS）；趋势失败不影响价格可用 | 架构：胖接口会让缓存键被日期污染；价格是主功能，附加功能失败不许污染主功能 | C.4 + D.3 |
| — | v1.4 | ⑥ **朱砂按钮 hover/active 绝对不许变亮**（余量 0.10，5% 混白即掉到 4.5 以下），一律压深或用阴影/描边 | PM 补的坑——前端做悬停态的默认手法就是调亮 | B.2.1 |
| — | v1.4 | ⑦ 供应商类型补「枚举码 ↔ 中文」映射表（`online/factory/rental/freelancer/internal`）；说明人员与物料共用一张 suppliers 表，外聘 vs 自有的成本对比天然成立 | 架构：改徽章枚举比改库便宜（库里改一个值要动三处） | C.6 |
| — | v1.4 | ⑧ 折算格小数自纠改成「一键换基准单位」出口（`要不要改成按张比价？` + 按钮） | PM：让他填 0.083 会长期制造脏数据，不如直接建议换基准 | C.4B + E.2 |
| — | **v1.5** | ① **手填率拆成两种原因**（`no_price`/`all_expired` 真缺价 vs `found_but_not_used` 有价没用），并加 `found_but_not_used < 20%` 这个**与权限无关**的界面质量指标；手填那一刻上报 `manual_cost_reason` | PM 12.1.1：一个笼统的手填率会让团队默认"是体验问题"，去优化一个成员根本进不去的表单。**一个不能指向对症动作的指标等于没有指标** | E.7 |
| — | v1.5 | ② **每条价格显示录入人/最后修改人 + 可按人筛选**（比价卡片 11px 灰字一行、表格视图加「录价人」列） | R15 三个选项都要它；且"谁录的"可见本身就是社会压力，比权限更能治乱录 | D.1.1 / D.1.2 |
| — | v1.5 | ③ 工作台「最近改价」升级为**「最近动作」**：`录价 / 改价 / 手填` 三合一、可按人筛、**仅管理员可见、只记录不阻断、不做排行** | PM：管理员需要可见清单。手填必须进榜——它是"无记录、无法追溯"的操作，比录错价更需要被看见。做成排行榜会诱导为排名乱录 | C.2 |
| — | v1.5 | ④ 权限表把「录价」标为 **待定 R15（当前按否实现）**、「修改/覆盖已有价格」标为**恒为否（不随 R15 变）** | 升级给用户拍板，我们不自作主张改用户原话 | C.9 |
| — | v1.5 | ⑤ 报价单明细加**快照语义说明**：已发出的单子，名称/供应商/价格不随库变化；草稿才实时取最新价。行上不显示"现价变了"的对比 | TC-11：单据是历史、比价页是现在，两者不能混在一张表里说话 | C.7 |
| — | v1.5 | ⑥ 报价单列表**默认不列 `void`**，筛选里可选 | TC-13.3：作废件不参与台账默认列表、不计入统计 | C.8 |
| — | v1.5 | ⑦ `pricing_mode` 英文码按 PRD/01a 定为 `per_day / per_event / per_person_day / per_hour / per_half_day`（架构信里写的是不带前缀的，以用例为准）；「禁止横向滚动」明确只约束 ≥1366，窄窗口允许横滚但必须仍可编辑 | TC-3B / TC-5B.2 / TC-12B.2 | C.4 / D.1C / E.5 |
| — | **v1.6** | ① **切换税口径必须给整单合计前后值**（`¥13,166.67 → ¥12,308.33`，18px/590），区分自动定价行与手工定价行，并预告缺价行；明确缺价行**对客价保持原值不清零、仍计入合计**。上一版写的「只说成本会变、不说金额会变」是错的 | PM TC-4C.5/4C.6 反例：自动定价行 `对客价 = 成本 ÷ (1−毛利率)`，成本变则**金额必变**。我上一版"怕吓到人"的出发点，和含税口径那件事同源——都是让系统替用户做了决定 | C.7 |
| — | v1.6 | ② **新增 §A.3 第 5 条设计原则「不报错的错误才是危险的」**：两个值都合法、都能算出数、其中一个是错的地方，必须强制二选一或显式确认，绝不允许静默用默认值。本产品共五处：含税口径 / 交易性质 / 计价方式 / 折算系数 / `cost_source` | PM 把「口径不一致不能比」从含税一处升成通则，我把它的判据抽成了通用原则 | A.3 新增 + 全篇五处回指 |
| — | v1.6 | ③ **`tax_basis` 与 `tax_included` 分工钉死**：前者是请求参数（必传）、后者是响应行属性；**禁止拿 `rows[0].tax_included` 回填切换器**。含税口径的值存 `inclusive`/`exclusive` 两码，**出单时同名同值域透传、零映射**，中文只在渲染层 | 架构 ①②：它是 `resolvePrice()` 的入参不是文案；存中文字面量意味着中→英映射漏一个值就静默走错分支 | C.4 + C.7 + F.21/22 |
| — | v1.6 | ④ **比价降级原因枚举按架构泛化重命名**：`TAX_BASIS_MISMATCH → MIXED_BASIS`、`TAX_BASIS_MISMATCH_ONLY → ONLY_OTHER_BASIS`，新增 `basis_dimension`（`tax/unit/nature/pricing_mode/null`）；文案表放 `src/domain/compare-reason.ts`，**精确匹配、禁止字符串前缀判断**，未命中退回兜底文案 | PM 把「口径不一致」升成跨单位/跨性质/跨计价方式的通则，带 `TAX` 的码在另外三个场景里读起来就是错的 | C.4 + F.24 |
| — | v1.6 | ⑤ **分段 Tab 的维度改为「`pricing_nature` + `pricing_mode`」**：物料非时间单位退化为按性质（线框不变）；时间类单位出现「按天/按场」；人员只按计价方式（5 值）。同一组件、一个维度入口、两套文案表 | 架构 信3：人员侧若沿用主体 `pricing_nature` 会把「按场 ¥2,800」和「按天 ¥1,500」标成同一组，是同一种事故的另一个版本 | C.4 Tab 表 + D.1C |
| — | v1.6 | ⑥ **列表页 `lowest_summary` 多行渲染**：`is_multi_group = true` 必须逐组出多行（`租 ¥380/天` + `买 ¥8,000/块`），**禁止取 `groups[0]`**；单组 36px、多组 52px 行高，允许表格行高不齐；5 处共用。物料库线框已按此重画并与外框对齐到 86 列 | 架构 信3：`lowest_price` 标量字段已删。取 `groups[0]` 是"看起来跑得通、实际给出错数"，且列表页没有 Tab 兜底 | C.3（线框重画）+ C.4 + F.23 |
| — | v1.6 | ⑦ **`internal`（自有）类型的两条界面要求**：录价单价下方常驻 `这是内部成本折算，不是对外支付`；比价卡片对 `internal` 加 `自有` 徽章、摘要把「自有」写进结论 | TC-4D.2 / 4D.4：不写这句，报价员会拿人力成本摊销当市场价对外报，或得出"自己人比外聘贵"这种没头没尾的结论 | C.4B + D.1.1 |
| — | v1.6 | ⑧ 工作台字段与 `GET /dashboard/summary` 逐一对齐（5 字段），补 `recent_price_changes[].is_overwrite` 的界面处理（`改价 · 覆盖`）；**`manual_cost_line_ratio` 后端给、首页不给位置**，只在设置页与月度导出出现 | 架构 ④；首页四块的准入标准是"每一块都能指向一个具体动作"，不能指向动作的数字放进来会让整块被学会忽略 | C.2 |
| — | v1.6 | ⑨ **移动端只读、三档保留，但不再独立设计版式**：三页统一标注「复用桌面详情页单列布局」；移动专属件只有底部只读提示条、`复制链接`、Tab 横向滚动条 | 客户 Q4 答「手机查价不是刚需」，team-lead 批准合并；省下的工时花在比价页与报价单编辑器上 | E.5 |
| — | v1.6 | ⑩ 录价阶梯区按性质给不同 placeholder：`rental_per_day` → `如：租 3 天以上通常有折`；买断/加工 → 按数量。**只改 placeholder 与标题，不改校验不改结构** | 客户 Q2「以租赁为主」；team-lead 倾向 placeholder 而非常驻提示语（常驻提示会被读成"系统建议我打折"） | C.4B |
| — | v1.6 | ⑪ §F 新增通用条款 **「附加功能失败不许污染主功能」**：趋势/缩略/外链/导出/未读数任何次要请求失败，只在自己位置降级为 `没加载出来 · 重试`，不弹全局错误、不拦主流程 | 架构 ⑤ 把这条从我针对趋势图写的局部规则升为通用条款 | F.20 |
| — | v1.6 | ⑫ 对外定性措辞定稿：权限收益写 **「降低顺手转发」**，全文不出现「安全 / 保密 / 防泄露」 | team-lead：写成安全反而让人以为平台兜底，然后更放心地截图 | J + C.7 |
| — | v1.6 | ⑬ Phase 1 冻结。剩余意见转入 `docs/decisions/OPEN-DECISIONS.md`（3 条），不在本文件继续迭代 | team-lead 冻结指令：边际收益已下降，剩余留给 Phase 2 | 全篇 |
| — | **v1.7** | ① **人员比价的分组基准从 `items.pricing_mode` 换成 `prices.unit_mode`**（这一条价自己的计价方式）。反例：按「人天」备案的讲师，A 经纪按场报 ¥2,800，按主体分组会被归进「按人天」组和别人的 ¥1,500 一起标最低——正是本次要修的事故换了个入口回来。`items.pricing_mode` 降级为**只做表单默认值与列表展示** | PM v1.8：基准错了，我 v1.6 写的那条会让分组标题标错组 | C.4 Tab 表 + C.3 + C.5 + F.15 |
| — | v1.7 | ② **三个计价字段的分工钉死**：`prices.unit_code`（短码，表单选项值，可写）/ `prices.unit_mode`（带前缀，分组与展示，只读）/ `items.pricing_mode`（表单默认与列表展示，不落库，**绝不参与分组**）。前端两套码表，不做运行时互转 | PM 6.4 对照表：短码是「单位本身」，带前缀是「按什么计价」；两套并存就是必现 bug | C.4 新增对照表 + F.15 |
| — | v1.7 | ③ **组内只有 1 家不标「最低」**，Tab 上只写 `1 家`；**主体默认与单条报价不一致不报警、不纠正**（TC-3B.8）；同一主体在分段里有的组有他有的没有，这是现实，不做完整度评分 | 唯一一家标最低等于没说，还会让人以为这家最便宜；按场报一次是正常的商务行为，标成异常就是把正常操作说成错误 | C.4 + C.5 |
| — | v1.7 | ④ **附件三条边界落地**：客户版只带 `PricedItem` 附件、不带 `PriceBook` 报价截图，导出菜单显式给一行 **`客户版不含供应商报价附件（3 张）`**（带数字，0 张不渲染）；删除确认不许写「彻底删除 / 不可恢复」，改成「已发出的报价单里的图仍会保留」；`accept` 显式列 `jpeg/png/webp/pdf`，**不写 `image/*`**（SVG 可内嵌脚本），前端 onChange 二次校验 + 服务端第三次 | PRD v1.8 §6.6.10 / TC-14C：**成本不只在数字里，也在截图里**；写错事实比不写更糟——用户会按不可恢复做决定，然后发现图还在，从此不信任何确认框 | C.7 + D.5 |
| — | v1.7 | ⑤ **R15 定案为分层开放（客户选 c）**：`member` 能新建价、不能覆盖 / 停用 / 改性质；权限表重排；新增 **「新建一条价」动作规范**——动作名叫「新建一条价」不叫「改价」，打开后供应商 / 单位 / 性质 / 折算系数预填且只读，**只放开单价与生效日**，Toast 写明旧价在昨天结束 | team-lead：**动作名字决定他会不会误以为历史被覆盖了**。放开的两个字段正好是唯一不影响分组结论的字段，放多了等于把 §C.4 那个事故从后门放回来 | C.9 权限表 + C.7 新节 + D.5 403 文案 |
| — | v1.7 | ⑥ **报价单新增「项目类型」下拉**（5 值 + 空值回退），毛利率阈值按类型取值，汇总条文案说出**是哪个阈值**（`低于「品牌发布会」的 22%`）；设置页第 1 项改为 5 类型 + 默认，**逐项可留空回退** | 客户 Q3；逼管理员填满 5 个数他会全填 25%，等于没分 | C.7 + C.9 |
| — | v1.7 | ⑦ **阈值只改颜色与自检提示**：不许置灰汇总条、不许禁用出单按钮、不许让负毛利以外的数字变红 | team-lead 明确；v1.2 已钉过一次，新逻辑不得破 | C.7 + C.9 |
| — | v1.7 | ⑧ **交易性质改为按分类预填**（设备器材 `rental_per_day` / 定做 `custom_made` / 标品 `purchase`），**预填值可见可改、单条改动不影响分类默认**；**人员侧没有这个字段**，录价抽屉按 `item_type` 分叉，两个下拉不同时出现 | 客户 Q2 + PRD v1.8：灰掉的默认值是最坏形态，用户会以为系统替他定好了；两个下拉同现会让人以为一个物料能同时按两种维度分组 | C.4B |
| — | v1.7 | ⑨ **导出声明默认 `inclusive`**，但**切换弹窗方向不许写死**：标题动词、`换成「X」`、按钮、两个合计的先后全由 `from` / `to` 拼，镜像都要能跑；并区分 `quotes.tax_statement`（单据属性）与 `app_settings.tax_statement_default`（建单初值） | 客户 Q7 定默认含税 → 第一次切换是含税→不含税，但一张不含税的单切回去必须同样正确 | C.7 + C.9 |
| — | v1.7 | ⑩ **403 / 413 / 415 三个错误态出界面**：403 必须说清「你可以新建一条」，不许只写「你没有权限」；413 / 415 必须给出实际大小与支持格式 | 只写无权限会把能做的事也说成不能做；不给实际大小的提示会让人反复重试同一张图 | D.5 |
| — | v1.7 | ⑪ 客户 Q5 无审批 → **全程删掉「待审批 / 已批准 / 提交审核」**，F.17 里将来加审批态的暗示也删；`draft/issued/void` 三态定死 | 客户原话「不要审批，不要发出蠢单就行」。留着将来加的钩子，会有人在 Phase 2 顺手把它加回来 | F.17 + 全篇 |
| — | v1.7 | ⑫ 客户 Q4 → **移动端三档定死**，<375 从纯提示页改为 **提示 + 仍渲染客户名与合计金额**；比价结果作为 `?compare=1` 状态并入 M2 / M3，不单独设计版式 | 客户：<375 提示过小但仍可看金额。做成纯提示页等于在客户面前打不开单子 | E.5 |
| — | v1.7 | ⑬ Open Decisions：OD-05 改述为「`unit_mode` / `unit_code` 双码表需在 openapi 顶稿」；OD-06（自有人员成本无维护入口）保留 | 字段改名后原 OD-05 的描述已过时 | OPEN-DECISIONS |
| — | **v1.7.1** | ① **权限判定拆两个函数**：`canCreatePrice(role)`（新建，member 可）/ `canOverridePrice(role)`（覆盖、归档、refresh、删主体、删供应商，仅 admin），**禁止合并成 `canEditPrice`**；同时把 §C.4B 里「录价是 admin 能力、member 五个入口一律不渲染」整段改写为分层开放 | 架构：合并之后必然出现「member 点新建被连带禁用」的反向 bug。原段落是 R15 定案前写的，与权限表已矛盾 | C.4B 整段 + C.7 表 + F.25 |
| — | v1.7.1 | ② **`pricing_nature` 第四值 `service`**（人员恒取）；人员侧**不出现这个选项**（单值下拉是假选择），**物料侧三值 / 人员侧五值，两侧下拉项数量不同** | 架构：枚举已加第四值；只有一个合法值的选项会让用户以为自己理解错了 | C.4 Tab 表 + C.4B |
| — | v1.7.1 | ③ **`unit_mode` 值域钉死 5 个 + `NULL`**，无 `per_sqm` / `per_sheet`；`unit-mode.ts` 只有 5 项，非时间类不生成 label；`NULL` 退 `unit_code` 中文，不拼「按㎡」 | 架构：自编 `per_*` 会让分组按单位分裂成两组，还会让物料行的 `null` 匹配不上、价格整批被过滤且不报错 | C.4 对照表 + F.26 |
| — | v1.7.1 | ④ **`/price-lookup` 不回退换价**：只回 `other_basis_exists` + `other_basis_price`（**取值路径见 v1.7.2 ①：只在 422**），**禁止回填成本框**；提示写「该供应商只报了不含税价 ¥X，本单声明含税——请让供应商补报，或手工填成本」，行仍是缺价态 | 架构 + Q7：换口径取到的是合法但错的数，与 §A.3 第 5 条同源 | C.4B 新增小节 |
| — | v1.7.1 | ⑤ **`refresh-prices` 两态**：`dry_run` 必传无默认 → 先出差异清单（能变的 / 不变的 / 取不到价）→ 再确认写入；`include_manual` 是 checkbox、**默认不勾**；不整批回滚，第 2 步只给 Toast | 架构：一个「确定要刷新 12 条吗」的弹窗，用户在没看到差异前无法回答 | C.4B 新增小节 |
| — | v1.7.1 | ⑥ **`42205 NO_VALID_PRICE` 与「主体没价」分开**；**`warn_rate_used` / `warn_rate_source` 直接渲染**并在汇总条标 `按项目类型` / `默认`，前端不反推 | 架构：两句混用会把补救动作教错；分级配置最常见的抱怨是不知道改的是哪一层，解法是把来源标在数字旁 | D.5 + C.7 + F.28/29 |
| — | **v1.7.2** | ① **`other_basis_*` 只在 422 错误体，200 不带**：`200` → `PriceLookupResult`（读 `other_basis_price` 得 `undefined`）；`422 / code=42205` → `PriceLookupMiss`。提示条只能写在 422 分支内，删掉「`res.data.other_basis_price` 有值就显示」这种写法 | 架构：200 里留着就是一个恒为 `false` 的死字段，TS 生成的类型会让人以为 200 也能读到提示 → 写出永远 `undefined` 的分支，**提示永不出现且不报错** | C.4B 取值路径 + F.27 |
| — | v1.7.2 | ② 新增三字段各管一件事：`other_basis_tax_included`（判「含税/不含税」文案，**不从 `tax_basis` 反推**）/ `other_basis_price`（只进提示金额位，**不进成本框、不进合计与毛利**）/ `other_basis_price_id`（「看这家别的口径」跳转，**服务端不计算、前端不拿它二次查价**）；提示里的主体名与口径名用 422 回显的 5 个字段查字典，不拿请求参数自己拼 | 反推等于把口径逻辑在渲染层写第二遍，两份真相迟早不一致；二次查价是一次隐式换口径，正好绕过本节的禁令 | C.4B 三字段表 + F.27 |
| — | v1.7.2 | ③ 采纳我先前提的 advisory：openapi 里 `unit_mode` 是 `type + enum + nullable`（5 个枚举值 + null），**不是** `allOf: [$ref] + nullable`（会生成一个永远匹配不上数据的 `"NULL"` 字符串成员）。已核 5 处 | 这类残留编译通过、运行不报错，只是在码表里多一个死键，将来没人能解释它为什么存在 | C.4 / F.26（口径未变，仅记录已核对） |
| — | **v1.8** | ① **侧栏去掉「人员库 → 嘉宾价」入口**，`/guests` 路由保留（老书签仍落预置视图），侧栏在这种情况下高亮「人员库」 | 人员库本身就能按分类筛；两个入口并排会被读成两个模块。0.1.9 刚把这个入口修好能用，用户看过后判断不需要它 | 全局外壳 + C.5 |
| — | v1.8 | ② **顶栏去掉消息通知图标**（连未读角标一起），`/notifications` 接口保留不动 | 通知只有读接口、没有列表页，摆一个点了没反应的铃铛比不摆更糟 | 全局外壳 |
| — | v1.8 | ③ **C.9 成员表从只读改为可编辑**：右上「新建成员」+ 每行「编辑」→ 抽屉内改姓名 / 角色（管理员↔成员）/ 启用停用 / 重置密码；能力表抽成 `ROLE_CAPABILITIES` 与判定函数同文件 | 三个账号接口（`POST/PATCH/DELETE /users`）0.1.0 就通了，界面却是只读——等于管理员开不了权限、停不了人、帮不了忘密码的人 | C.9 + 新增 `UserEditorDrawer` |
| — | v1.8 | ④ **「最后一个管理员」判定补上「是否正在生效」**：已停用的管理员可以降成成员，不再误报 40904 | 加了编辑界面后这个错判立刻显形：停用过的账号改不回成员，提示却是「系统至少要保留一个启用状态的管理员」——和用户在做的事毫无关系 | `users.service.ts` + 自检 +1 项 |
| — | **v1.9** | ① **攒单的勾选卡片里长出一行「用哪家」**：只有一家→写名字和价；同一性质多家→下拉（首项是价格库的默认取价）；多种性质→下拉首项`选一种（共 2 种性质）`且红框、不给默认值。选中的 `supplier_id + pricing_nature` 随攒单传给 `/price-lookup` | 用户原话"勾选物料后无法选择供应商"。这条能力 0.1.0 就在（接口有 `supplier_id` 参数），界面从没传过——勾完只能先攒进去、再逐行点成本格换，勾五项来回五趟 | C.7 攒单段 + `PickerPanel` / `useQuoteLines.addItems` |
| — | v1.9 | ② **选品栏分类从纵向列表改为横排一行**（自己横滚） | 8 个分类吃掉 250px，320px 的选品栏只剩 90px 给物料列表：一屏一张卡片，勾两个要滚三次 | C.7 |
| — | v1.9 | ③ **明细表「成本单价」列不再随密度收起**，精简档阈值 1366 → 1520 | 精简档把它藏了，而它正是"换供应商"的唯一入口——省掉 84px 换来一个功能消失；1440 的屏上完整档 1104px 一摆就横滚，把毛利率和操作列推出视口 | C.7 明细表 |
| — | v1.9 | ④ **单元格数字走格式化**：`4333.3333` → `4,333.33`，`1.00` → `1`；聚焦编辑时给同样的显示值，提交按数值比较（尾数精度不算修改） | 库里是 numeric(14,4)，原始值直接摆出来就是四位数小数长尾；而"点一下没改却发了一条 PATCH"是另一种静默噪音 | C.7 + `CellInput` |
| — | **v1.10** | ① **删除权上收到管理员，并放开到"任意状态"**：报价单（含已发出，软删）、物料、人员、物料价、供应商都能真删；`DELETE /items/:id` 从"停用"改回**真删除**（连带删该主体的价） | 客户原话"管理员可以删除报价单(包含已经发出的报价单)、物料库、物料价、人员库、供应商"。此前 DELETE 名为删除实为停用，管理员以为删干净了其实还在库里；而"已发出的单不能删"在多建、建错的场景下没有出路 | C.9 新增权限矩阵 + 各列表操作列 |
| — | v1.10 | ② **作废 / 恢复下放给成员**（`canArchive`），并把作废从价格接口的 `canOverridePrice` 里摘出来；恢复价格时先查同口径在效价，撞了返回 40902 并说出是哪家哪段 | 客户原话"成员不能删除…但是可以作废和恢复"。改价仍只给管理员——判据是可逆性不是重要性：作废能反悔，改价会悄悄改掉所有人据以报价的数 | `domain/permissions.ts` + `price-patch.service` |
| — | v1.10 | ③ **`canVoid` 放开到草稿**，并新增 `canRestore`；恢复后回到 `issued_at ? issued : draft` | 成员不能删之后，建错的草稿既删不掉也不能作废 = 死胡同。一律恢复到 issued 会让一张空草稿变成"已发出但零行"，点进去是个空白客户版 | `domain/quote-status.ts` + `quote-actions.service` |
| — | v1.10 | ④ **四个列表加「含已作废」开关 + 已作废徽章**；物料价新增比价页下方的「价格记录」表（此前 `archivePrice` 接口存在但没有任何界面入口） | 没有这个开关，作废=看不见，恢复功能等于不存在；价格侧此前根本没有生命周期管理界面，录错的价只能改不能撤 | C.3 / C.4 / C.5 / C.6 |
| — | v1.10 | ⑤ **分类字典从只读改为可维护**：改名 + 新增（可挂一级或二级），仅管理员；删除/合并/排序明确不做 | 客户原话"设置-分类字典，管理员可以新增修改物料树名称和人员树名称"。接口 0.1.0 就有 POST/PATCH，页面却写着"暂时只在库里改"——客户口里的叫法一年变几次，改不动就会随手塞进"最像的那个"，分类体系是这么烂掉的 | C.9 分类字典 |
| — | v1.10 | ⑥ **危险按钮的红色第一次真正生效**：`.btn--link.t-danger` / `.btn--icon.t-danger` 复合选择器 | `.t-danger` 与 `.btn--link` 同为单类选择器，前者定义在文件前部 → 后者覆盖，"删除"和"作废"长得一模一样。这是最不该长得一样的一对按钮 | `globals.css` |
| — | **v1.11** | ① **登录页密码的「露出来 / 藏起来」文字按钮换成框内右侧的眼睛图标**（新组件 `PasswordInput`，28×28 点击区，`aria-label` 随状态切换，`type="button"` 不提交表单） | 客户原话"露出来和藏起来修改成一个眼睛图标放在密码框右侧"。原按钮挂在标签行右端，离它管的那一格有 20px 远，读起来像页面级开关而不是这一格的开关；图标贴在框内，归属不用解释 | C.1 + `ui/field.tsx` |
| — | v1.11 | ② **登录表单宽度 `360px` → `min(360px, 100%)`** | 375px 屏上 `.login__right` 两侧各 32px 内边距，只剩 311px，360px 定宽的表单连同「登 录」按钮一起溢出视口——新加的眼睛图标正好长在被切掉的那一侧，等于这个功能在手机上不存在 | `globals.css` |
| — | v1.11 | ③ `Field` 摘掉无人使用的 `aside` 插槽（唯一调用点就是登录页那个文字按钮） | 留着它，下一个想在标签行右边塞按钮的人会再犯一次同样的错：把开关放得离它管的东西太远 | `ui/field.tsx` |
| — | **v1.12** | ① **新增「默认毛利率」`margin_thresholds.default_margin_rate`，与「预警线」拆成两个数**；新建弹窗、编辑页单头、设置页三处联动：选类型就带出该类默认值 | 客户原话"选择不同的类型，报价单的毛利率没有同步改变"。查下来不是没联动，是**根本没有这个字段**——类型此前只决定预警线的颜色。硬把预警线当默认值更糟：建单初值正好压在自己的警告线上，报价员一进来就是琥珀色，于是他学会无视琥珀色，负毛利那天也不会多看一眼 | C.7 + C.9 + `20261105090000_margin_default_by_type` |
| — | v1.12 | ② **换类型只改毛利率初值，绝不重算任何已有行的对客价**；存量行按预警线 +10 个点回填（上限 95%） | 报价员改一个类型，不该让 27 行已经报出去的价悄悄变掉。要重算有「按毛利率重算」那条独立路径，它带确认弹层并列出会被覆盖的手改行数 | `quote.service.ts` + `settings.store.ts` |
| — | v1.12 | ③ **比率 → 百分比输入框统一走 `rateToPctInput()`**，全仓清掉 `String(n * 100)` 与手写的 `Math.round(n * 1000) / 10` | `0.28 * 100 = 28.000000000000004`。联动做完了但框里显示一长串尾数，等于把"没反应"换成"反应成一个没法看的数"——客户会直接判定系统算错了，比原来更糟。先放大到万分之一位取整再缩回来，`0.185 → "18.5"` | `lib/format.ts` + 4 个调用点 |
| — | **v1.12** | ④ **客户版版面收敛成单一来源**：`domain/customer-sheet.ts` 纯计算 → HTML（`PaperSheet`）与 xlsx（`export.service`）两个渲染器；四个版式开关 `layout / grouped / unit_price / discount` 从预览页透传到导出接口 | 客户原话"打印和导出客户版 PDF 按钮，打印出来的页面要跟 EXCEL 保持一致"。此前预览和 Excel 是两段各自维护的渲染代码，同一张单能看出两个样子；只要还是两套，今天对齐了明天又歪 | C.8 |
| — | v1.12 | ⑤ **xlsx 合计行补上「报价合计」标签**；**优惠行移到合计之上** | ExcelJS 的 `mergeCells` 只保留合并区左上角那格的值，标签原来写在右侧格子里 → 打印出来只有金额没有名目，客户不知道这行是什么钱。优惠行若排在合计之后，客户会拿折后合计再减一次一千块 —— 这是真金白银的错 | `export.service.ts` |
| — | v1.12 | ⑥ 打印态：`@page A4 / 14mm 12mm`、`thead` 跨页重复、`tr` 不劈开、工具栏与右侧面板 `no-print`、`.paper-wrap { min-width: 0 }` | 报价单动辄三四十行，第一版打印出来第 2 页开始没有表头，客户翻过去只看到一堆数字；纸面宽度按屏幕 `min-width` 撑开还会横向切掉右半边 | `globals.css` |
| — | **v1.13** | ① **供应商编辑抽屉新增「开票信息」五项**：纳税人识别号 / 公司地址 / 联系电话 / 开户银行 / 银行账号，全部可选 | 客户原话"供应商编辑页面增加……等可选字段"。这五项在开发票那一刻才用得上，但错了的代价发生在几周后（票被退回重开），所以输入时就校验，而不是等财务挨个打电话问"这家税号是多少" | C.6 + `20261105094500_supplier_invoice_info` |
| — | v1.13 | ② **`联系电话` 独立成列（`company_phone`），不并入已有的 `contact_phone`** | 前者是税务局认的号（印在发票上），后者是找到这个人的手机。合成一列，迟早有人把私人手机号开进发票；那时改的就不只是数据库了 | `domain/invoice-info.ts` |
| — | v1.13 | ③ **入口处规范化**：税号转大写、去空格与横杠；账号只留数字。**只校验格式不校验校验位** | 从微信复制过来的税号常带全角、空格、小写。而校验位算法一旦算错，正确的新税号会被判非法，人就会被迫瞎填一个"能过"的号——那比不校验更糟 | `domain/invoice-info.ts` |
| — | v1.13 | ④ 详情抽屉里五项**填了才显示整块**，标题写 `已填 n/5` | 一块全是「—」的表让人以为这里坏了；而填满的人打开详情是来抄数的，五格必须一眼看全 | C.6 |
| — | v1.13 | ⑤ 编码型数字串（税号 / 账号 / 电话）新增 `.num-code`；报错时收起 hint、输入框转红 | 第一版直接套了 `.num`，而它是表格金额列的规矩（右对齐 + nowrap）：18 位税号被推到框子最右边，上面「公司地址」却是左对齐，同一张表单里两种对齐像两个版本拼的。报错时灰提示与红错误叠在一起，人只会读短的那行 | `globals.css` + C.6 |


---
| — | **v1.14** | ① **报价单抬头印报价人姓名 + 电话**（`users.name` / `users.phone`），客户版版面、编辑页单头两处同步；只填姓名时只印姓名，都没有则整行不出现 | 客户要问的是"这行你是怎么算的"，接电话的应该是做这张单的人，不是公司客服；取值跟着账号走而不是存快照，换号后客户打旧号才是更坏的结果 | C.7「报价人」+ C.8 + `customer-sheet.ts` + `users.phone`（新列） |
| — | v1.14 | ② **物料库 / 人员库加备注**（同一列 `items.note`），列表不加备注列，比价页单独一行，搜索命中；报价单加行时作为行备注初值 | 桁架含不含运输、音响含不含调音师这类话以前只存在报价员脑子里，换人接单就要重新打电话问 | C.3「物料备注」+ C.5「人员备注」+ 比价页 |
| — | v1.14 | ③ **行备注可就地编辑，且只对这张单有效**：点开即输入、`Enter` 提交、`Esc` 还原、两行封顶；`issued` 后只读；清空必须真清空（服务端判 `!== undefined`，不是 `??`） | 客户原话要的是"改后的内容只对这张报价单有效"。初值与事实混在一个字段里，会让改单悄悄改掉档案，或者"清了又被填回来"——后者比没有这个功能更伤人 | C.7「行备注」+ `quote_items.note` + `.line-note` |
| — | v1.14 | ④ **列表默认「全部状态」，按状态排序草稿优先**（草稿 → 已发出 → 已作废），筛选区右侧给三个状态的计数 | 默认落在「草稿」时，"我上周发出去那张"在默认视图里看不见；默认应回答"我有哪些单"，不是"我还欠什么"。默认序走旁路，不进通用排序器（会拼出 `DESC DESC`） | C.8 + `/api/v1/quotes` 的 `DEFAULT_ORDER` |
| — | v1.14 | ⑤ `deploy/verify.mjs`：新增 8 项自检；自检临时账号改为固定 `selfcheck_temp`（首次建、之后复用），自检单跑完自动删除 | 原来每跑一次就往「设置 / 账号」加一行「自检临时账号」、往列表加一张「自检样例」，跑五遍用户就分不清哪张是自己的单 | `deploy/verify.mjs`（64 项） |

| — | **v1.15** | ① **录价默认含税**：抽屉里「含税价」开关初值 `false → true`，「保存并再录一家」与关闭抽屉后都复位成含税；折叠条上带出当前口径（`展开更多（含税价 · 起订量 / 阶梯价 / 交期）`）；开关下加一句"这条按不含税记的话，含税单子取不到价" | 客户原话「物料和人员的报价默认都是含税价」。原来的写法最坏：服务端 `tax_included ?? true` 默认含税、界面 `useState(false)` 默认不含税——界面把接口的默认顶掉了，两处不一致。而取价按口径严格匹配、不回落，记错口径的价会让含税单子显示"没有有效价格"，价明明录了却找不到 | C.4B「折叠 8 项」+ `price-entry-drawer.tsx` + `deploy/verify.mjs`（66 项） |

| — | **v1.16** | ① **客户版「规格」与「备注」拆成两列**：详细档列序 `项目 / 规格 / 备注 / 单位 / 数量 / 单价 / 小计`（原为一列「规格 / 说明」+ 备注塞在项目名括号里）；打印、PDF、客户版 Excel 三处同源（`customer-sheet.ts`）；精简档省掉这两列时备注折进项目名括号，不再静默丢掉 | 客户原话「规格/备注分开单独列，都需要显示在 EXCEL 和打印页面上」。合成一列时客户分不清哪句是参数、哪句是条件（"3m×6m"和"含运输不含电费"是两种信息）；长备注还会把规格挤没。原来备注只在详细档以括号附在项目名后，客户版一旦切精简档这条信息就消失 | `customer-sheet.ts` + `export.service.ts` + C.7「规格/备注」 |
| — | v1.16 | ② **未选项目类型也落默认毛利率**：`createQuote` 走新的 `defaultTargetMarginRate()`（类型默认 → `default_margin_threshold` → 0.25），不再写 NULL；新建弹窗加载设置后预填毛利率（用户已输入则不覆盖）；选回「未选」时回到全站默认而不是留着上一个类型的点数；占位文案里的百分比改为读设置动态渲染 | 客户原话「项目类型未选，默认毛利率没有生效」。下拉上写着「未选（按默认 25%）」，实际落库 NULL，于是第一行加进来就报「这张单没有目标毛利率，无法反推」——**默认值写在界面上却不算数，比不写更糟**。根因是前端初值空串 + 后端 `project_type ? ... : null` 两处都在等对方给值 | C.7「项目类型」空值 + `settings.store.ts` + `new-quote-button.tsx` + `quote-header.tsx` |
| — | v1.16 | ③ `deploy/verify.mjs` 从 66 项加到 **68 项**：详细档表头必须是「规格」「备注」两列、精简档两列都不出现、导出里备注值确实落在备注列且项目名不带括号、未选类型建单的 `target_margin_rate` 等于全站默认 | 这三件事都是"界面上看着对、数据其实不对"的类型，只靠看截图验不出来 | `deploy/verify.mjs` |

| — | **v1.17** | ① **备注列移到小计之后**（整表最后一列）：详细档列序 `项目 / 规格 / 单位 / 数量 / 单价 / 小计 / 备注`；合计与优惠行的金额仍钉在「小计」列，备注列在合计行留空 | 客户原话「备注列移动到小计列后面」。备注是不定长的一段话，夹在规格与小计之间时，一条长备注会把金额列压成两行——而金额是客户唯一必须一眼读准的东西；放到右边缘它才能只占用自己的宽度向下长 | `customer-sheet.ts` + `paper-sheet.tsx` + `export.service.ts` + C.7 |
| — | v1.17 | ② **长备注自动换行且不破坏 A4**：`.paper-tbl` 改 `table-layout: fixed`，列宽由 `SheetColumn.width`（Excel 字符宽）换算成百分比，两边比例一致；文字列 `overflow-wrap: break-word`（先按空格断，装不下才词内断，避免 `1.2m×2.4m` 被切成「2.4 / m」），数字列 `nowrap`；单元格左右内边距 8px→6px，否则 8 列时「序号」只剩 23px 会被压成竖排 | 客户原话「备注内容太长需要自动换行不能影响 A4 纸打印效果」。auto 布局下备注的宽度随内容变，同一客户两张单的列宽都不一样；另外金额被折行会断在逗号处（`1,234` / `.00`），客户会按两笔读 | `globals.css` + `paper-sheet.tsx`（实测 186mm 内容宽 `scrollWidth=clientWidth=703`） |
| — | v1.17 | ③ **客户版 Excel 开了 `alignment.wrapText`（同一个 `SheetColumn.wrap` 驱动）与打印设置**：A4 纵向、页边距 12/14mm（与 `@page` 一致）、`fitToWidth=1`、表头行跨页重复 | 不设 wrapText 时长备注在 Excel 里会盖到邻格或被截断；不设 fitToWidth 时 8 列会横向溢到第二页，客户拿到的「第一页」只有序号和项目 | `export.service.ts` |
| — | v1.17 | ④ `deploy/verify.mjs` 68 → **71 项**：备注在表头最后且紧跟小计、备注格 `wrapText=true` 而小计格为 `false`、合计金额仍写在「小计」那一格（合并区只保留左上角，写错格会静默消失） | 这三件事都是"屏幕上看着对、文件里其实不对"的类型：换行是单元格属性不是内容，合并区的值写错格在预览里看不出来，导出来才发现金额不见了 | `deploy/verify.mjs` |

