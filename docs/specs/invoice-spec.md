# 发票管理模块 · 技术契约（Phase 1）

> 版本：0.1.35 基线 │ 状态：待评审 │ 归属：首席架构师
> 本文是**契约**，不是设计随笔。前后端各自实现时，字段名、状态码、错误码、默认值以本文为准；
> 要改先回到这里改，不允许在实现里"顺手调一下"。
>
> **调研来源（均经核实，非记忆）**
> - 腾讯云《通用票据识别（高级版）》文档：`product/866/90802`（Action `RecognizeGeneralInvoice`，Version `2018-11-19`）
> - 数据结构文档：`api/866/33527`（`InvoiceItem` / `VatInvoiceInfo` / `VatElectronicInfo`）
> - npm 包本地核对：`tencentcloud-sdk-nodejs-ocr@4.1.344`（`package.json`、`ocr_models.d.ts`、`ocr_client.d.ts`、`common/exception/tencent_cloud_sdk_exception.d.ts`）
> - npm 包本地核对：`yazl@3.3.1`（`index.js` 中 `FILE_NAME_IS_UTF8 = 1 << 11`）、`archiver@8.0.0`（依赖表）
> - 项目现有范式：`contract.service.ts`、`storage.service.ts`、`upload-stream.service.ts`、`file-type.ts`、`http.ts`、`db.ts`、`next.config.ts`

---

## 0. 不可让渡的五条（做错任一条，这个模块就不该上线）

1. **金额零浮点**：三个金额列 `numeric(14,2)`，DTO 一律字符串（`db.ts` 已把 numeric OID 1700 映射成 string）。禁止 `Number()` 参与求和与差值判断。
2. **发票号码唯一性不能只看号码**：纸质票的 8 位号码**在不同发票代码下会重复**，唯一键必须是 `(invoice_code, invoice_no)`，`invoice_code` 用**空串**而非 NULL 兜全电票。否则不同供应商的两张真票会被当成同一张跳过。
3. **上传必须流式落盘**：沿用 `stageUploadStream`，禁止 `req.formData()` / `arrayBuffer()`。OCR 环节才把 ≤7.5MB 的字节读进内存（10MB 是 **base64 后**的上限）。
4. **ZIP 必须流式**：禁止 `adm-zip`（整包在堆里拼）。500 份 5MB 扫描件 = 2.5GB 堆，进程直接消失。
5. **红票不能"自动判完就算"**：`RecognizeGeneralInvoice` **不返回红票标记**（见 §5.3 核实结论），系统只能做启发式判定 + 人工兜底，且必须记录判定来源（`status_source`）。

---

## 1. 约束（先写约束，再谈方案）

| 类别 | 约束 | 它带来的设计后果 |
|---|---|---|
| 规模 | 每月新增发票 ~200–2000 张；3 年 ≤7 万行；单张原件 200KB–8MB | 列表单表查询足够，`ILIKE` 全表扫在 7 万行内可接受（~30ms）；ZIP 单包按体积卡上限 |
| 延迟 | 上传识别 ≤6s（P95）；列表 ≤400ms；ZIP 首字节 ≤1.5s | OCR 超时 20s、列宽走覆盖索引；ZIP 不预下载文件再打包 |
| 成本 | OCR 按次计费；COS 请求按次 | 识别前先查重（重复票不调 OCR 不花钱；但查重需要号码 → 顺序见 §5.2，**先 OCR 后查重**是必然代价，已计入） |
| 合规 | 发票含购买方税号、金额；票据原件属财务凭据 | 原件私有读（COS 预签名 / 本地 `/uploads` 需登录）；不允许物理删除原件，只软删库行 |
| 团队 | 2 人（前后端各一）；已锁定 Next 16 / pg 手写 SQL / zod | 不引入 ORM 写库、不引入队列、不引入新框架；新增依赖只允许 `tencentcloud-sdk-nodejs-ocr` + `yazl` |

---

## 2. 数据模型

### 2.1 三个决策表（人话 + 代价）

| 决定 | 我选了什么 | 一句话人话 | 改的代价 |
|---|---|---|---|
| 发票号码唯一键 | `UNIQUE (invoice_code, invoice_no)`，`invoice_code` 缺省空串 | 同一张票不能录两遍；但两张不同来源的同号票不会被误吞 | **高**：唯一键改一次要重建索引并人工核对历史重复 |
| 金额可否为空 | `amount` / `tax_amount` / `total_amount` 三个都**可空** | 没认出来的金额就空着，不能拿 0 冒充 | 低：统计已按「非空求和 + 缺金额张数」双口径返回 |
| 一票多原件 | `invoice_files` 1:N，同一份原件可被多行引用（同一 `storage_key`） | 一个多页 PDF 里识别出 3 张票，原件只存一份 | 中：物理清理由周任务判「无引用才删」（见 §6.4） |

### 2.2 `invoices`

```prisma
/// 发票台账。一张票一行，字段以「财务能拿去对账」为准，不以「OCR 返回了什么」为准。
model Invoice {
  id              String    @id @default(uuid()) @db.Uuid
  /// 发票号码：全电 20 位 / 纸质 8 位。规范化后只保留数字与大写字母
  invoiceNo       String    @map("invoice_no") @db.VarChar(32)
  /// 发票代码：纸质票 10/12 位；全电票与多数电子票为空 → 存空串，不存 NULL（唯一索引不认 NULL 相等）
  invoiceCode     String    @default("") @map("invoice_code") @db.VarChar(20)
  /// normal 正常 / red 冲红。与 deleted_at 正交：冲红是业务状态，删除是可见性
  status          String    @default("normal") @db.VarChar(10)
  /// 状态怎么来的：ocr 自动判定 / manual 人工改过。人工改过的不再被重传覆盖
  statusSource    String    @default("ocr") @map("status_source") @db.VarChar(10)
  /// 票种：OCR 的 SubType 原值（VatSpecialInvoice / VatElectronicInvoiceFull / …）
  invoiceType     String    @default("Unknown") @map("invoice_type") @db.VarChar(40)
  /// 票种中文（SubTypeDescription 原值），列表直接显示，避免前端维护映射表
  invoiceTypeLabel String   @map("invoice_type_label") @db.VarChar(60)
  /// 开票日期；OCR 认不出时为空，不拿上传日冒充
  issuedOn        DateTime? @map("issued_on") @db.Date
  buyerName       String    @default("") @map("buyer_name") @db.VarChar(200)
  buyerTaxNo      String?   @map("buyer_tax_no") @db.VarChar(30)
  sellerName      String    @default("") @map("seller_name") @db.VarChar(200)
  sellerTaxNo     String?   @map("seller_tax_no") @db.VarChar(30)
  /// 不含税金额（元）。冲红为负
  amount          Decimal?  @db.Decimal(14, 2)
  /// 税额（元）。冲红为负
  taxAmount       Decimal?  @map("tax_amount") @db.Decimal(14, 2)
  /// 价税合计（元）。冲红为负
  totalAmount     Decimal?  @map("total_amount") @db.Decimal(14, 2)
  /// ok / derived（由另两项推算）/ mismatch（|amount+tax-total| > 0.01）
  amountCheck     String    @default("ok") @map("amount_check") @db.VarChar(10)
  /// OCR 原始响应里与本票相关的那一段（jsonb）：口径变了能回溯，不必再花一次钱重识别
  ocrRaw          Json?     @map("ocr_raw")
  /// 腾讯云 RequestId：出问题时要拿它找腾讯云对账
  ocrRequestId    String?   @map("ocr_request_id") @db.VarChar(64)
  remark          String?   @db.Text
  createdBy       String?   @map("created_by") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  /// 软删：票是凭据，误删可恢复；物理文件由周任务回收
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(3)

  createdByUser User?            @relation("InvoiceCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  files         InvoiceFile[]
  contracts     ContractInvoice[]

  @@unique([invoiceCode, invoiceNo])
  @@index([invoiceNo])
  @@index([issuedOn(sort: Desc)])
  @@index([status])
  @@index([deletedAt])
  @@index([createdAt(sort: Desc)])
  @@map("invoices")
}
```

**为什么 `buyerName` / `sellerName` 是 `NOT NULL DEFAULT ''` 而不是可空**：这两列是查询维度，`ILIKE` 对 NULL 恒为 NULL，会让"销售方含 X"筛掉所有空白行；空串则老实参与匹配（用户搜空白也没意义）。而金额没识别出来时**必须可空**——写成 0 会让"金额合计"少算却不报警，而合计正是他们拿去对账的数。

### 2.3 `invoice_files`

```prisma
/// 发票原件（PDF / JPG / PNG）。一个发票可挂多份；同一份物理文件可被多行引用。
model InvoiceFile {
  id           String   @id @default(uuid()) @db.Uuid
  invoiceId    String   @map("invoice_id") @db.Uuid
  /// local 本地磁盘（UPLOAD_DIR/invoices/…）| cos 腾讯云对象存储
  storage      String   @default("local") @db.VarChar(10)
  /// local 时是 UPLOAD_DIR 下的相对路径；cos 时是对象键（不含桶名）
  storageKey   String   @map("storage_key") @db.VarChar(300)
  url          String   @db.VarChar(1000)
  originalName String   @map("original_name") @db.VarChar(200)
  mime         String   @db.VarChar(120)
  /// bigint：单份上限 20MB，但保持与 contract_files 同型，避免以后再改
  sizeBytes    BigInt   @map("size_bytes")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  /// 物理回收要按 storage_key 反查引用数（§6.4）
  @@index([storageKey])
  @@map("invoice_files")
}
```

### 2.4 `contract_invoices`

```prisma
/// 合同 ↔ 发票。多对多：一张合同常挂多张进项票，一张票也可能被多个项目合同引用。
model ContractInvoice {
  contractId String   @map("contract_id") @db.Uuid
  invoiceId  String   @map("invoice_id") @db.Uuid
  createdBy  String?  @map("created_by") @db.Uuid
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  invoice  Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  user     User?    @relation("ContractInvoiceCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)

  @@id([contractId, invoiceId])
  @@index([invoiceId])
  @@map("contract_invoices")
}
```

### 2.5 `contracts` 新增 `status`

```prisma
  /// 合同状态：negotiating 签订中 / performing 履约中 / settling 结算中 / settled 已结算 / terminated 已终止
  status String @default("negotiating") @db.VarChar(20)
  @@index([status])
```

**状态码存英文、中文只在界面**——理由同 `contracts.category`：以后要加状态或改叫法，不用动数据。

### 2.6 迁移文件与手写 SQL 要点

文件：`prisma/migrations/20261116120000_invoices/migration.sql`（Prisma 只按序执行 SQL，不做 diff；`db.ts` 的注释已说明 DDL 归 Prisma CLI）

**顺序不能乱**，三处易错：

```sql
-- 1) contracts.status：先回填、再设默认、最后 NOT NULL。
--    顺序反了（先 SET DEFAULT 再 UPDATE）不会报错，但语义上会让"存量回填成履约中"
--    这件事看起来像是默认值干的，半年后没人敢改这个默认值。
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status varchar(20);
UPDATE contracts SET status = 'performing' WHERE status IS NULL;   -- 存量一律「履约中」（业务方确认）
ALTER TABLE contracts ALTER COLUMN status SET DEFAULT 'negotiating'; -- 新建默认「签订中」
ALTER TABLE contracts ALTER COLUMN status SET NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status);
ALTER TABLE contracts ADD CONSTRAINT contracts_status_valid
  CHECK (status IN ('negotiating','performing','settling','settled','terminated'));

-- 2) invoices.invoice_code 必须 NOT NULL DEFAULT ''
--    唯一索引对 NULL 不生效（多行 NULL 互不冲突），空串才真正挡住重复。
CREATE UNIQUE INDEX IF NOT EXISTS invoices_code_no_key ON invoices (invoice_code, invoice_no);

-- 3) 金额允许负数（冲红），只卡绝对上限：
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_range
  CHECK (total_amount IS NULL OR (total_amount > -1e12 AND total_amount < 1e12));

ALTER TABLE invoices ADD CONSTRAINT invoices_status_valid CHECK (status IN ('normal','red'));
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_check_valid
  CHECK (amount_check IN ('ok','derived','mismatch'));
```

> `COMMENT ON COLUMN` 逐列写中文说明，与 `20261112110000_contract_category_storage` 一致（那次的注释后来救了排查）。

---

## 3. 金额：三个字段的定义、精度与容差

| 字段 | 含义 | 来源（OCR） | 符号约定 |
|---|---|---|---|
| `amount` | 不含税金额（金额合计） | `PretaxAmount` / `SubTotal` | 冲红为负 |
| `tax_amount` | 税额合计 | `Tax` / `SubTax` | 冲红为负 |
| `total_amount` | 价税合计 | `Total` | 冲红为负 |

- 精度：`numeric(14,2)`，单位「元」，最多两位小数。库层会**静默四舍五入**，所以领域层先按两位小数规范化（`domain/money.ts` 的 scale=2 定点，禁 `toFixed`）。
- 统计口径：`SUM(total_amount)` / `SUM(tax_amount)` / `SUM(amount)`，**只加非空**，同时返回 `missing_amount_count`（三列有任一为空的行数）。界面文案：`合计 ¥12,300.00（其中 2 张金额待补）`。

### 3.1 三项关系与容差（决定写死在 `domain/invoice-record.ts`，可单测）

```
TOLERANCE = 0.01 元（1 分）

1. 三项齐全：|amount + tax - total| <= 0.01 → amount_check='ok'
                             否则           → amount_check='mismatch'（仍入库，界面标黄）
2. 缺一项、另两项齐全：用 total 为真值推导缺项 → amount_check='derived'
     total + tax 有、amount 缺 → amount = total - tax
     total + amount 有、tax 缺 → tax = total - amount
     amount + tax 有、total 缺 → total = amount + tax
3. 缺两项及以上：三列原样存（能存几个存几个），amount_check='ok'
   —— 不推导，也不报错：只有 total 一张票是常见的（部分电子票无价税分离），
      硬要它"自洽"只会逼用户瞎填一个数。
```

**为什么不直接拒绝 mismatch**：OCR 的 1–2 分误差是行业常态（尤其多行明细合计）。拒绝入库等于让用户为 OCR 的误差返工；入库 + 标黄，人一眼能看到，且不阻塞台账。**代价**：合计里会混入一张差 1 分的票，需要人点进去看——这个代价比"传 20 张有 6 张失败"小得多。

---

## 4. API 契约

信封沿用 `{ code, data, message }`；认证 Cookie `rc_session`；`runtime = 'nodejs'`、`dynamic = 'force-dynamic'`。
查询参数命名与 `contracts` 保持一致（snake_case，`include_deleted=1`，`page`/`limit`，`limit ≤ 100`）。

### 4.1 端点表

| # | Method | Path | 认证 | 请求 | 成功响应 | 主要错误码 |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/invoices` | 登录 | query：`q` `invoice_no` `invoice_code` `buyer` `seller` `issued_from` `issued_to` `status=normal\|red` `has_file=0\|1` `contract_id` `include_deleted=0\|1` `page` `limit` | `{ items, total, page, limit, hasMore, summary }` | 40001 40101 |
| 2 | POST | `/api/v1/invoices` | 登录 | body：`invoice_no`* `invoice_code` `issued_on` `buyer_name`* `seller_name`* `buyer_tax_no` `seller_tax_no` `amount` `tax_amount` `total_amount` `status` `remark`（手工录入，无原件） | 201 `InvoiceDetail` | 40001 40901（票号已存在） |
| 3 | GET | `/api/v1/invoices/:id` | 登录 | — | `InvoiceDetail`（含 `files`、`contracts`） | 40401 |
| 4 | PATCH | `/api/v1/invoices/:id` | 登录 | body：任意可编辑字段（部分更新；不传=不动，`null`/空串=清空） | `InvoiceDetail` | 40001 40401 40901 |
| 5 | PATCH | `/api/v1/invoices/:id/status` | **admin** | body：`{ status: 'normal'\|'red' }` | `InvoiceDetail` | 40301 40401 |
| 6 | DELETE | `/api/v1/invoices/:id` | **admin** | — | `{ deleted: true, file_count }` | 40301 40401 |
| 7 | POST | `/api/v1/invoices/:id/restore` | **admin** | — | `InvoiceDetail` | 40301 40401 |
| 8 | POST | `/api/v1/invoices/upload` | 登录 | **原始字节流**；header `Content-Type: application/octet-stream`、`X-File-Name: <encodeURIComponent>` | 201 `UploadResult` | 40001 41301 41501 42208 50202 50203 50204 |
| 9 | GET | `/api/v1/invoices/:id/files/:fileId/raw` | 登录 | — | PDF/JPG/PNG → 流式 `inline`；其它 → 302 | 40101 40401 |
| 10 | GET | `/api/v1/invoices/zip` | 登录 | query：与 #1 同（忽略 `page`/`limit`） | `application/zip` 流 | 40001（无一可下载）/ 41301（超上限） |
| 11 | GET | `/api/v1/contracts/:id/invoices` | 登录 | — | `{ items: InvoiceBrief[] }` | 40401 |
| 12 | POST | `/api/v1/contracts/:id/invoices` | 登录 | body：`{ invoice_ids: string[] }`（1–200 个） | `{ linked: number, items }` | 40001 40401 |
| 13 | DELETE | `/api/v1/contracts/:id/invoices/:invoiceId` | 登录 | — | `{ deleted: true }` | 40401 |
| 14 | PATCH | `/api/v1/contracts/:id/status` | 登录 | body：`{ status }` | `ContractDetail` | 40001 40401 |
| 15 | GET | `/api/v1/settings/ocr` | 登录 | — | `OcrSettingsDTO`（只回 `enabled` / `secret_id` / `secret_key_set` / `secret_key_hint` / `region`，**永不回 `secret_key`**） | 40101 |
| 16 | PATCH | `/api/v1/settings/ocr` | **admin** | `{ enabled, secret_id, secret_key, region }`；`secret_key` 留空 = 不改 | `OcrSettingsDTO` | 40001 40301 |
| 17 | POST | `/api/v1/settings/ocr/test` | **admin** | — | `{ ok, latency_ms, note }` | 50202 50203 |

\* 必填。

**#15 的 GET 当年对 member 开放**：上传按钮要据此置灰（未配置时不让人传完 20 张才失败）。2026-11-17 起随整块收权改成**仅管理员**——成员走不到上传按钮，这条理由不再成立。密钥值永远不出去——只给"配没配 + 末四位"，与 `getStorageSettings` 同一套做法。

**`PATCH /contracts/:id` 不接受 `status`**（只有 #14 一条写入路径）。理由：两处都收，就会出现"抽屉保存顺手把状态冲回默认"这类事故——`parseContractInput` 目前对未提交字段是"不动"，但人一旦把 `status` 加进抽屉表单，新建时的默认值就会覆盖手工改过的状态。

### 4.2 DTO

```ts
interface InvoiceListItem {
  id: string; invoice_no: string; invoice_code: string;
  status: 'normal' | 'red'; status_source: 'ocr' | 'manual';
  invoice_type: string; invoice_type_label: string;
  issued_on: string | null;              // yyyy-mm-dd，db.ts 的 date 解析器原样返回，不做时区转换
  buyer_name: string; buyer_tax_no: string | null;
  seller_name: string; seller_tax_no: string | null;
  amount: string | null;                 // 十进制字符串，禁 number
  tax_amount: string | null;
  total_amount: string | null;
  amount_check: 'ok' | 'derived' | 'mismatch';
  remark: string | null;
  file_count: number;
  contract_count: number;                // 关联合同数（列表用来显示"已挂合同"）
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface InvoiceSummary {
  count: number;                          // 命中总数（与 items 同口径）
  sum_amount: string;                     // 非空求和，无命中时 "0"
  sum_tax_amount: string;
  sum_total_amount: string;
  missing_amount_count: number;           // 三列任一为空的行数
}

interface UploadResult {
  item: InvoiceDetail;                    // 落库的那张（或已存在的那张）
  duplicated: boolean;                    // true = 票号已存在，本次未新建
  attached_file: boolean;                 // true = 命中去重但该票原先没原件，已把这份原件补上
  extra_items: Array<{                     // 同一文件里还识别出的其它票（多页 PDF / 混贴）
    invoice_no: string; total_amount: string | null;
    page: number; saved: boolean; reason?: string;
  }>;
  warnings: string[];                     // 例：'金额三项差 0.02 元，已标黄'
}
```

### 4.3 新增错误码（须同步加进 `http.ts` 的 `ERROR_STATUS`）

| code | HTTP | 文案（直接给用户看，禁出现 prisma/constraint/OCR 内部码） |
|---|---|---|
| 42208 | 422 | 这张票没认出来（图片模糊或版式不支持）。换一张清晰的，或用「手工录入」先把票号记下来。 |
| 50202 | 502 | 发票识别服务没开通或已欠费。到腾讯云控制台开通「文字识别 OCR」后重试。 |
| 50203 | 502 | 识别服务这次没返回结果（请求号 xxx）。稍后重试一次；连续失败把请求号告诉管理员。 |
| 50204 | 504 | 识别超时了。网络慢或图片太大，压缩后再传一次。 |

腾讯云错误码 → 我们错误码的映射表（写到 `invoice-ocr.service.ts`，**只映射这两类**，其余统一 50203）：

| 腾讯云 code | 我们的 code |
|---|---|
| `FailedOperation.ImageBlur`、`FailedOperation.ImageDecodeFailed`、`FailedOperation.OcrFailed`、`FailedOperation.UnsupportedInvoice` | 42208 |
| `ResourceUnavailable.InArrears`、`ResourceUnavailable.ResourcePackageRunOut`、`FailedOperation.UnOpenError` | 50202 |
| `LimitExceeded.TooLargeFileError` | 41301 |
| 其它 / 超时 | 50203 / 50204 |

---

## 5. 上传识别链路

### 5.1 技术选型（已核实）

| 项 | 结论 |
|---|---|
| npm 包 | `tencentcloud-sdk-nodejs-ocr@4.1.344`（依赖 `tencentcloud-sdk-nodejs-common` + `tslib@1.13.0`） |
| 引入 | `import { ocr } from 'tencentcloud-sdk-nodejs-ocr'` → `new ocr.v20181119.Client({ credential, region, profile })`（README 明确"装指定产品包后要改引入"；`services/ocr/index.d.ts` 只有命名导出 `ocr`） |
| 打包 | **必须**把 `'tencentcloud-sdk-nodejs-ocr'` 加进 `next.config.ts` 的 `serverExternalPackages`（与 `cos-nodejs-sdk-v5` 同理：它按需拼 Node http 请求，被 bundle 后会出现"开发能调、生产 502"） |
| Action / Version | `RecognizeGeneralInvoice` / `2018-11-19`，endpoint `ocr.tencentcloudapi.com` |
| 入参 | `ImageBase64`（**不传 `ImageUrl`**：本地部署没有公网可达地址，COS 桶是私有读，预签名链路过长且会把票据暴露给第三方抓取） |
| 关键入参 | `EnablePdf: true`、`EnableMultiplePage: true`、`EnableOther: true`（默认已是 true，仍显式写，避免服务端默认值变更）、`EnableCutImage: false`、`EnableItemPolygon: false`、`EnableSeal: false`（都省流量省时间） |
| 频率 | 5 次/秒（官方）→ 前端并发 3，留余量给重试 |
| 超时 | `profile.httpProfile.reqTimeout = 20`（默认 60s 会让一个卡住的上传拖死整批） |
| 体积 | **base64 后 ≤10MB**；像素单边 20–10000px；格式 PNG/JPG/JPEG/PDF（**不收 GIF、不收 OFD**） |
| 响应结构 | `Response.MixedInvoiceItems[].SingleInvoiceInfos.<SubType>`；另有 `TotalPDFCount`、`RequestId` |
| 异常对象 | `TencentCloudSDKHttpException`：字段 `code`（如 `FailedOperation.ImageBlur`）、`message`、`requestId`、`traceId`、`httpCode?` |

### 5.2 单张状态机

```
RECEIVE ──▶ SNIFF ──▶ STAGE ──▶ OCR ──▶ NORMALIZE ──▶ DEDUP ──▶ PERSIST ──▶ DONE
  │          │          │        │          │            │
  │          │          │        │          │            └─ 命中：若该票 file_count=0 → 补挂原件；
  │          │          │        │          │               否则丢弃临时文件，返回 duplicated=true
  │          │          │        │          └─ 符号归一 / 容差判定 / 日期解析 / 号码规范化
  │          │          │        └─ 见 5.4 三种降级
  │          │          └─ stageUploadStream → 临时盘（不占内存）
  │          └─ 只收 pdf / jpg / png（webp 拒：OCR 文档未承诺支持）
  └─ 空 body / 断流 → 40001
```

`PERSIST` 在一个事务里：`INSERT invoices` → `INSERT invoice_files`（N 张票共用同一 `storage_key`，各自一行）。**先落库后删临时文件**，顺序反了失败就没有可回滚的东西。

### 5.3 响应字段 → 我们的列（**最容易写错的三条已加粗**）

| 我们的列 | OCR 路径 | 备选路径（同名不同时用） | 备注 |
|---|---|---|---|
| `invoice_no` | `SingleInvoiceInfos.<SubType>.Number` | `ElectronicFullNumber` | **① 全电票的 20 位号码在 `Number`，不是 `ElectronicFullNumber`**（后者是"全电号码"字段，纸质全电票才会单独有值）；`Number` 空才回落 |
| `invoice_code` | `.Code` | — | 全电票为空 → 存 `''` |
| `issued_on` | `.Date` | — | **② `Date` 是中文格式 `2016年04月11日`，也有 `2026-03-01`**，必须写解析器（见下），不能 `new Date()` 硬转 |
| `buyer_name` / `buyer_tax_no` | `.Buyer` / `.BuyerTaxID` | — | 注意不是 `BuyerName` |
| `seller_name` / `seller_tax_no` | `.Seller` / `.SellerTaxID` | — | **③ 是 `SellerTaxID`（大写 ID），不是 `SellerTaxId`/`SellerTaxNo`**；`VatElectronicInfo` 与 `VatInvoiceInfo` 同名，但**两张结构体字段集不同**，映射函数必须按 SubType 分组取 |
| `amount` | `.PretaxAmount` | `.SubTotal` | 不存在 `Amount` 字段（文档无） |
| `tax_amount` | `.Tax` | `.SubTax` | |
| `total_amount` | `.Total` | — | 价税合计（小写）；大写是 `TotalCn`（不用） |
| `invoice_type` | `InvoiceItem.SubType` | — | 如 `VatElectronicInvoiceFull` |
| `invoice_type_label` | `InvoiceItem.SubTypeDescription` | `TypeDescription` | 直接落库，前端不再维护映射 |
| `status` | **无字段** | — | 见 5.5 启发式 |

**两套结构体的分组（务必按组取字段，不能混取）**

| 结构体 | 覆盖的 SubType |
|---|---|
| `VatInvoiceInfo` | `VatSpecialInvoice`、`VatCommonInvoice`、`VatElectronicCommonInvoice`、`VatElectronicSpecialInvoice`、`VatElectronicInvoiceBlockchain`、`VatElectronicInvoiceToll` |
| `VatElectronicInfo` | `VatElectronicInvoiceFull`、`VatElectronicSpecialInvoiceFull` |
| 其它（`AirTransport`、`TrainTicket`、`QuotaInvoice`、`OtherInvoice` …） | Type 不在 3/16 → **拒收**：42208「这张不是增值税发票」 |

> 收单范围（本轮明确不做）：只收 `Type ∈ {3, 16}`。火车票/机票/定额票也能识别，但我们的台账要的是进项发票，混进来会污染"金额合计"。

**日期解析规则**（`parseIssuedOn`，纯函数）：接受 `2026年04月11日` / `2026-04-11` / `2026/4/11` / `2026.04.11`；先全角转半角、去空白；用 `isRealDate` 校验日历真实性（`2026-02-30` 拒）；解析不出返回 `null` 并在 `warnings` 里提一句，不阻塞入库。

**号码规范化**：全角转半角、去空格与横杠、字母转大写；非 `[0-9A-Z]{6,32}` → 视为未识别（42208）。理由同 `normalizeTaxNo`：OCR 常把 `0` 认成 `O`、把空格当字符。

### 5.4 三种降级

| 情况 | 行为 | 返回 |
|---|---|---|
| **未配置 OCR**（库里没密钥，或 COS 那对密钥也没有） | 上传入口不进入识别：路由先查配置，直接 409 | `40901`「发票识别还没配置。到「设置 → 发票识别」填腾讯云密钥（默认用对象存储那一对）。」前端在打开上传前 GET `/settings/ocr`，未配就把按钮置灰并显示同一句话——**不要让人传完 20 张才发现没配** |
| **OCR 超时**（>20s） | 丢弃临时文件，**不落库**（不留半行） | `50204`，前端该文件标红、可单独重试，不中断整批 |
| **OCR 失败 / 识别为空** | 同上，丢弃 | `42208`；前端给两个出口：「重传这张」和「手工录入」。**不做"存了没数据"的待补录行**——半成品行会让合计出现一个没人负责的空洞 |

> 失败即丢弃的代价：用户可能想留着这张图。接受这个代价，因为原件还能从微信/邮箱再拿一次，而库里多一行空数据没人会去清。

### 5.5 冲红判定与归一（`status` / 符号）

已核实：`RecognizeGeneralInvoice` 返回的 `VatInvoiceInfo` / `VatElectronicInfo` **没有红票标记字段**（`RedLetterInvoiceMark` 只存在于 `VatInvoiceOCR` 返回的 `VatInvoice` 结构体）。所以：

```
判定顺序（domain/invoice-record.ts，纯函数，可单测）
1. Total / PretaxAmount / Tax 任一为负         → status='red'
2. Title 或 SubTypeDescription 含「红字」「红冲」→ status='red'
3. 其它                                        → status='normal'
归一：status='red' 时把三项取负（若原本已是负数则取绝对值再取负，避免 --得+）
      status='normal' 时三项取绝对值？—— 否：normal 保持原符号，只把 '-' 去掉视为异常并记 warning
```

**人工改状态的连锁动作**（#5 接口必须做，不能只改状态列）：`status` 改了，三项金额**同步重定符号**（red → 负、normal → 正），并置 `status_source='manual'`。否则"冲红 3 张但合计没变"——这个 bug 只有对账时才会被发现。

---

## 6. ZIP 批量下载

### 6.1 选型（三个方案 + 代价）

| 方案 | 结论 | 代价 |
|---|---|---|
| **`yazl@3.3.1`** | **选它** | 只有 1 个依赖（`buffer-crc32`）；`index.js` 硬编码 `FILE_NAME_IS_UTF8 = 1 << 11`，中文名**永远**按 UTF-8 写且置位，不需要我们手工补位；`addReadStreamLazy` 让 COS 下载按需开始（不会同时开 500 个连接）；常量内存 |
| `archiver@8.0.0` | 不用 | 9 个传递依赖（`zip-stream`/`compress-commons`/`readdir-glob`/`tar-stream`…），能力（目录递归、glob）我们一个都不用；CVE 面与包体都更大 |
| `adm-zip` | **禁止** | 整包在堆里拼装。500 份 5MB = 2.5GB 堆 → OOM；而 OOM 只表现为进程消失、无日志 |

### 6.2 实现要点

- 流式：`zipfile.outputStream` → `Readable.toWeb()` → `new NextResponse(stream, { headers })`。
- **`compress: false`（store 模式）**：原件几乎全是 PDF/JPG/PNG（已压缩），deflate 压不动（收益 <2%），却要吃满一个 CPU 核。store 模式 CPU ≈0、内存更低、首字节更快。**代价**：包体比压缩后大约 2%–5%，对"下载 30 张票"的场景无感。
- 每份文件必须传 `size`（`invoice_files.size_bytes`）：yazl 用它做校验，尺寸不符会报错——这正好能抓住"库里记 3MB、磁盘上是 0 字节"的坏记录。
- 单包上限：**文件数 ≤ 500**、**累计 ≤ 2GB**。超限 41301，文案带实际值：「这次要下 812 份（3.1GB），一次最多 500 份 / 2GB，先用日期筛小一点」。
- 首字节前完成：查询清单（只 select 必要列）+ 体积/数量校验 + 本地文件存在性预检。**这些都在开始写响应头之前**，否则错误只能以"下载到一半断了"的形式出现。
- 缺文件：**跳过，不整包失败**；只要有跳过，包尾追加 `_缺失清单.txt`（UTF-8 无 BOM，内容：票号 / 文件名 / 原因）。整包失败会让 499 份好的也下不来，而缺的那份用户能从清单里认出来。
- 目录结构：**全平铺**（不建子目录）。理由：用户下载后是在资源管理器里按名称排序找某一张票，多一层目录只是多一次点击。
- 文件名规则：`清洗(original_name)`；清洗 = 去掉 Windows 非法字符 `\ / : * ? " < > |` 与控制字符、去掉首尾空格与结尾的点、UTF-8 字节数截断到 ≤120 字节（**按字节不是按字符**：Windows 单个路径段 255 字节，中文 3 字节/字）、空则回落 `${发票号}.${ext}`；重名追加 `(2)`、`(3)`。
- `Content-Disposition`：复用 `export.service.ts` 的 `contentDisposition()`（`filename="ascii 回退"` + `filename*=UTF-8''<encodeURIComponent>`）。**不能只给 `filename*`**：旧浏览器/下载器会拿不到名字而落成 `download.zip`。
- 不设 `Content-Length`：store 模式本可算出来，但需要在 `end()` 前拿到 `calculatedTotalSize` 并用它决定头，收益只是"浏览器显示总大小"。**代价**：Chrome 进度条显示"未知大小"，可接受。
- 错误中断：条目流出错时 `zipfile.outputStream.destroy(err)` → 连接中断，浏览器报"下载失败"。这比继续吐一个残缺 ZIP（用户解压后少几张票却以为齐了）安全。

### 6.3 前端如何发起

`window.location.href = url`（GET 带 Cookie），**不要 fetch→blob**：blob 会把整包读进浏览器内存，2GB 的包直接崩标签页。原生下载是浏览器流式写盘。

### 6.4 物理文件回收（与软删的关系）

- **删发票 = 只打 `deleted_at`，原件一字节不动**。理由同合同：扫描件常是唯一副本，恢复后必须还在。
- 因此周清理任务**不按"发票是否被删"来判断**，只按"这份对象还有没有库行引用"判断：

```
1) 列 UPLOAD_DIR/invoices/ 下的文件（COS 则 ListObjects 前缀 invoices/）
2) 对每个 storage_key 查一次：SELECT 1 FROM invoice_files WHERE storage_key = $1 LIMIT 1
3) 查不到 → 这是真正的孤儿（入库失败残留、或整张票被硬清理），删除
   查得到 → 保留。哪怕它所属的发票是软删状态
```

- 多票共用一份原件（多页 PDF）时，任何一张票的删除都不会让 `storage_key` 失去引用，原件安全；只有**所有**引用行都不存在时才回收。
- `invoice_files` 行本身只在两种情况被硬删：附件被显式删除、发票被硬清理（本轮不做硬清理，所以只有前者）。
- **顺序**：先删库行、再删磁盘。反了会留下"库里有一条、点开 404"的坏记录——那种记录比多留一个孤儿文件难查得多（同 `deleteContractFile` 的注释）。

---

## 7. 权限

> **2026-11-17 改口径**：发票台账整块收成**管理员专属**（合同模块同日同口径）。
> 下表是 0.1.36 的设计，撤销的原因写在表后——留着是因为"当初为什么放开"这件事
> 本身有信息量，将来有人想再放开时会先看到这里。

| 操作 | member | admin | 理由（0.1.36 当时） |
|---|---|---|---|
| 查看列表 / 详情 / 原件 / ZIP | ✅ | ✅ | 台账不给看就等于没有台账 |
| 上传识别 / 手工录入 / 编辑字段 | ✅ | ✅ | 录入是行政活，卡在管理员身上会变成"管理员不在就录不进"（沿用合同模块结论） |
| 关联 / 解除关联合同 | ✅ | ✅ | 可逆，误关联一条 DELETE 就回来 |
| **改发票状态（正常/冲红）** | ❌ | ✅ | 冲红会**翻转金额符号**，直接改"金额合计"这个对账数字。这类动作要么有第二个人看，要么不要让当天录票的人顺手做 |
| **删除 / 恢复发票** | ❌ | ✅ | 沿用 `canDeleteRecord`（软删可恢复） |
| OCR 设置 | ❌ | ✅ | 密钥 |

**现在的口径（0.1.37 起）**：上表前四行的 ✅ 对 member 全部变 ❌。

```ts
// src/domain/permissions.ts —— 单一出口，接口与界面判同一个函数
canAccessInvoices('admin') === true
canAccessInvoices('member') === false   // 读也拦，不只是写
```

落点有三处，缺一处就是漏的：

1. **接口**：`src/app/api/v1/invoices/**` 与 `contracts/**` 每支路由第一行调用
   `requireInvoiceAccess()` / `requireContractAccess()`，成员拿到 `40301` / HTTP 403。
   写成模块级一个函数，是因为"新加路由忘了判"是**静默**失效——接口照常 200。
2. **导航**：`components/app-shell.tsx` 按 `canAccessInvoices(user.role)` 决定要不要渲染入口。
3. **页面**：`components/ui/admin-gate.tsx` 把整块页面包住。**必须包在外层**——
   在页面函数体里 `if (!isAdmin) return null` 的话，`useEffect` 里的取数已经先跑了，
   成员打开页面照样发一次 403 请求，控制台一片红。

**撤销理由**（客户 2026-11-17 原话：合同和发票"全部功能需要管理员才可以操作，普通成员不能查看和操作"）：
放开读取的假设是"成员要拿这些数字干活"，实际用下来成员并不做对账，反而让
"这单签了没 / 这张票报了没"变成口头问答的替代品——两份口径并行时，
不一致的那一份不会报错，只会让人不再相信系统。收成一个人维护，数字只有一个来源。

**代价**（写清楚，别当没有）：管理员不在时，查一份合同、补一张发票都要等他。
缓解方式不是再开权限，而是把列表查得够快（模糊 + 分页），以及手工录入入口不做任何人工审核步骤。

---

## 8. 性能

### 8.1 列表与统计一次拿到（一次扫描，无 N+1）

```sql
SELECT i.id, i.invoice_no, …, 
       count(*)              OVER () AS total_count,
       coalesce(sum(i.amount)       OVER (), 0)::text AS sum_amount,
       coalesce(sum(i.tax_amount)   OVER (), 0)::text AS sum_tax_amount,
       coalesce(sum(i.total_amount) OVER (), 0)::text AS sum_total_amount,
       count(*) FILTER (WHERE i.amount IS NULL OR i.tax_amount IS NULL OR i.total_amount IS NULL)
                             OVER () AS missing_amount_count,
       (SELECT count(*) FROM invoice_files f WHERE f.invoice_id = i.id)::int AS file_count,
       (SELECT count(*) FROM contract_invoices ci WHERE ci.invoice_id = i.id)::int AS contract_count
  FROM invoices i
 WHERE …                                          -- 与列表同一套 WHERE
 ORDER BY i.issued_on DESC NULLS LAST, i.created_at DESC
 LIMIT $n OFFSET $m;
```

窗口聚合在 `LIMIT` **之前**求值，所以一次扫描同时得到「本页 20 行」和「全量合计」。**不要**写成两条 SQL（`count+sum` 一条、`items` 一条）——那是两次全表扫，且两次之间有人插一张票就会"合计和行数对不上"。

> `file_count`/`contract_count` 用相关子查询而不用 `JOIN`：`JOIN` 两张一对多表会让行数乘起来，必须 `DISTINCT` 才能除回来，那比子查询慢且更难读。

### 8.2 索引

| 索引 | 服务的查询 |
|---|---|
| `UNIQUE (invoice_code, invoice_no)` | 入库判重、按号码精确查 |
| `(invoice_no)` | 只给号码的精确查询（含 `invoice_code=''` 的全电票） |
| `(issued_on DESC)` | 默认排序、日期区间 |
| `(status)`、`(deleted_at)`、`(created_at DESC)` | 状态筛选 / 软删过滤 / 兜底排序 |
| `invoice_files(invoice_id)`、`(storage_key)` | 详情附件、回收时反查引用 |
| `contract_invoices(contract_id)`（主键前导）、`(invoice_id)` | 双向 |

**购买方/销售方模糊查询本轮不建索引**：`ILIKE '%x%'` 用不上 btree；`pg_trgm` 的 GIN 索引在 ≤7 万行时反而更慢（索引扫描 + 回表）。迁移文件里留一行注释写明阈值：**行数 >5 万或 P95 >400ms 时加 `CREATE EXTENSION pg_trgm` + GIN**。

### 8.3 内存上限

| 环节 | 峰值 | 算法 |
|---|---|---|
| 上传 | ~15MB/请求（buffer 7.5MB + base64 字符串 ~10MB） | 并发 3 → ~45MB |
| OCR 后 | 立即释放 buffer，只留标准化后的字段 | — |
| ZIP | **常量**（store 模式 + 逐条 lazy stream，`highWaterMark` 默认 64KB × 1 条） | 与包大小无关 |

---

## 9. 能力缝三角闭合（定义 / 实现 / 消费者）

| 能力 | 定义 | 实现 | 消费者 | 默认值 | 失败语义 |
|---|---|---|---|---|---|
| 发票识别 | `recognizeInvoice(buf, mime): Promise<OcrResult>`（`invoice-ocr.service.ts`） | 腾讯云 `RecognizeGeneralInvoice` | `POST /invoices/upload` | `enabled=false`（未配密钥不启用） | 未配置 → 409 引导设置页；超时 → 50204；COS 样式错误码翻译成人话 |
| 原件存储 | `persistLocalFile` / `putFileToCos` / `presignCosDownload`（**复用现有 `storage.service`，不新造**） | local + cos | `invoice_files` 读写、ZIP | `local` | COS 失败 → 50201（现有翻译） |
| ZIP 打包 | `buildInvoiceZip(query): ReadableStream` | `yazl` store 模式 | `GET /invoices/zip` | 500 份 / 2GB | 超限 41301；缺件跳过并写清单 |
| 合同状态 | `CONTRACT_STATUSES` + `isContractStatus`（`domain/contract.ts`） | `PATCH /contracts/:id/status` | 合同列表 / 抽屉下拉 | 新建 `negotiating`，存量 `performing` | 非法值 40001（不静默回落） |

**没有"预留接口"**：不写 `StorageAdapter` 抽象层（现有 `storage.service` 已经是那个抽象），不写"未来接真伪核验"的空函数（见 §12 风险 6）。

---

## 10. 文件清单

### 10.1 后端（新建）

| 路径 | 一句话职责 |
|---|---|
| `prisma/migrations/20261116120000_invoices/migration.sql` | 三张表 + `contracts.status` 回填 + 约束与索引（手写 SQL，顺序见 §2.6） |
| `src/domain/invoice-record.ts` | 纯函数：号码/日期/金额规范化、容差判定、红票归一、状态枚举、字段校验（前后端共用，可单测） |
| `src/domain/invoice-ocr.ts` | 纯函数：`MixedInvoiceItems` → 我们的字段（**不含 SDK 引用**，用固定 fixture 单测），含 SubType 分组表与拒收清单 |
| `src/server/services/invoice.service.ts` | 列表（含窗口聚合统计）/ 详情 / 新建 / 编辑 / 改状态（含重定符号）/ 软删 / 恢复 |
| `src/server/services/invoice-ocr.service.ts` | 腾讯云客户端单例（按密钥指纹缓存）、超时、错误码翻译、`status_source` 保护 |
| `src/server/services/invoice-file.service.ts` | 原件落盘（local/cos 分流）、补挂原件、`getInvoiceFileRef`、ZIP 用的清单查询、回收条件 |
| `src/server/services/invoice-zip.service.ts` | `yazl` 流式打包、文件名清洗与去重、缺失清单、上限校验 |
| `src/server/services/ocr-settings.service.ts` | OCR 密钥读写：默认复用 `app_settings.cos_storage` 的 SecretId/SecretKey，可独立覆盖；`GET` 只回末四位 |
| `src/app/api/v1/invoices/route.ts` | GET 列表（含 summary）/ POST 手工录入 |
| `src/app/api/v1/invoices/upload/route.ts` | POST 原始字节流 → 识别 → 入库（复用 `stageUploadStream`） |
| `src/app/api/v1/invoices/[id]/route.ts` | GET 详情 / PATCH 编辑 / DELETE 软删 |
| `src/app/api/v1/invoices/[id]/status/route.ts` | PATCH 改状态（admin，重定符号） |
| `src/app/api/v1/invoices/[id]/restore/route.ts` | POST 恢复（admin） |
| `src/app/api/v1/invoices/[id]/files/[fileId]/raw/route.ts` | GET 原件：本地流式 / COS 302 预签名（`inline`，PDF/JPG/PNG） |
| `src/app/api/v1/invoices/zip/route.ts` | GET 流式 ZIP（与列表同参数） |
| `src/app/api/v1/contracts/[id]/invoices/route.ts` | GET 已关联 / POST 批量关联（幂等 `ON CONFLICT DO NOTHING`） |
| `src/app/api/v1/contracts/[id]/invoices/[invoiceId]/route.ts` | DELETE 解除关联 |
| `src/app/api/v1/contracts/[id]/status/route.ts` | PATCH 合同状态（唯一写入路径） |
| `src/app/api/v1/settings/ocr/route.ts` | GET 配置（登录即可，不回密钥）/ PATCH 配置（admin） |
| `src/app/api/v1/settings/ocr/test/route.ts` | POST 用一张内置样例图真调一次，返回 `latency_ms` |
| `tests/invoice-record.spec.ts` | 容差、日期解析、号码规范化、红票符号归一、合同状态枚举 |
| `tests/invoice-ocr-map.spec.ts` | 用两份真实响应 fixture（纸质专票 / 全电普票）跑映射，含"字段取错就红"的断言 |
| `tests/invoice-zip-name.spec.ts` | 文件名清洗（Windows 非法字符 / 120 字节截断 / 重名追加）与 `Content-Disposition` |

### 10.2 后端（修改）

| 路径 | 改什么 |
|---|---|
| `prisma/schema.prisma` | 加 3 个 model；`Contract` 加 `status` 字段与索引 + `invoices ContractInvoice[]`；**`User` 加两条反向关系**（Prisma 要求两端都声明）：`createdInvoices Invoice[] @relation("InvoiceCreatedBy")`、`contractInvoices ContractInvoice[] @relation("ContractInvoiceCreatedBy")` |
| `next.config.ts` | `serverExternalPackages` 追加 `'tencentcloud-sdk-nodejs-ocr'`、`'tencentcloud-sdk-nodejs-common'` |
| `src/server/http.ts` | `ERROR_STATUS` 追加 42208 / 50202 / 50203 / 50204 |
| `src/domain/contract.ts` | 加 `CONTRACT_STATUSES` / `isContractStatus` / `DEFAULT_CONTRACT_STATUS`；`parseContractInput` **不**收 `status`（见 §4.1） |
| `src/server/services/contract.service.ts` | `SELECT` 增 `c.status`；`ContractDTO` 增 `status`；新增 `setContractStatus()` |
| `src/server/http.ts`（若需） | 复用 `requireDelete` 做发票删除，不新增鉴权函数 |
| `package.json` | `dependencies` 加 `tencentcloud-sdk-nodejs-ocr@4.1.344`、`yazl@3.3.1`（+ `@types/yazl` 到 devDependencies） |

### 10.3 前端（新建）

| 路径 | 一句话职责 |
|---|---|
| `src/app/(app)/invoices/page.tsx` | 发票台账页：筛选栏 + 统计卡 + 表格 + 批量上传入口 |
| `src/components/invoices/invoice-filters.tsx` | 查询条件（号码精确 / 购买方 / 销售方 模糊 / 日期区间 / 状态 / 是否已挂合同） |
| `src/components/invoices/invoice-summary-cards.tsx` | 张数 / 金额合计 / 税额合计 / 待补金额张数（差额标黄） |
| `src/components/invoices/invoice-table.tsx` | 列表、行选择（勾选范围用于 ZIP）、冲红行整行标负 |
| `src/components/invoices/invoice-upload-button.tsx` | 批量上传：并发 3、逐文件进度与结果（成功 / 重复 / 失败原因），失败可单条重试 |
| `src/components/invoices/invoice-drawer.tsx` | 详情 / 编辑 / 原件预览 / 关联合同 / 状态切换（admin 才显示） |
| `src/components/invoices/invoice-linked-contracts.tsx` | 抽屉内"已关联合同"，可解除 |
| `src/components/contracts/invoice-picker.tsx` | 合同抽屉里挑发票（按号码/销售方搜，支持多选） |
| `src/components/settings/ocr-settings-form.tsx` | 设置页「发票识别」块：开关、SecretId、SecretKey（留空=不改）、地域、测试连接 |

### 10.4 前端（修改）

| 路径 | 改什么 |
|---|---|
| `src/lib/types.ts` | `Invoice*` 类型、`InvoiceSummary`、`UploadResult`、`ContractStatus`、`Contract.status` |
| `src/lib/api.ts` | `listInvoices` / `getInvoice` / `createInvoice` / `updateInvoice` / `setInvoiceStatus` / `deleteInvoice` / `restoreInvoice` / `uploadInvoice`（复用 `uploadRaw`）/ `invoiceZipUrl` / `linkContractInvoices` / `unlinkContractInvoice` / `setContractStatus` / `getOcrSettings` / `saveOcrSettings` / `testOcr` |
| `src/components/app-shell.tsx` | 侧栏加「发票」入口（`href="/invoices"`），`crumbs` 加 `/invoices` |
| `src/components/icons.tsx` | 加 `IconInvoice`（**SVG**，沿用现有 `lucide-react` 包装，**禁止 emoji 当图标**，不新增图标库） |
| `src/components/contracts/contract-drawer.tsx` | 状态下拉（五态任意切换，保存即生效）+ 「关联发票」块 |
| `src/app/(app)/contracts/page.tsx` | 列表加状态列与状态筛选 |

---

## 11. 对账清单（Phase 3 交付时逐条核）

- [ ] 三张表建好，`invoices` 有 `UNIQUE (invoice_code, invoice_no)`（证据：`prisma/migrations/20261116120000_invoices/migration.sql`）
- [ ] 存量合同 `status` 全部非空且为 `performing`，新建默认 `negotiating`（证据：同上 + `schema.prisma` 的 `@default("negotiating")`）
- [ ] 三个金额列是 `numeric(14,2)` 且可空（证据：`schema.prisma`）
- [ ] 上传走 `stageUploadStream`，无 `formData()`（证据：`invoices/upload/route.ts`）
- [ ] 列表一次查询同时出 items 与 summary（证据：`invoice.service.ts` 的 `OVER ()`）
- [ ] ZIP 用 `yazl` 且 `compress: false`（证据：`invoice-zip.service.ts`）
- [ ] 改状态同时重定金额符号（证据：`invoice.service.ts` 的 `setInvoiceStatus`）
- [ ] `serverExternalPackages` 含 OCR SDK（证据：`next.config.ts`）
- [ ] 新错误码已进 `ERROR_STATUS`（证据：`http.ts`）
- [ ] 冲红行在列表与统计里都是负数（证据：手工造一张红票，合计应为负）

---

## 12. 风险与不可行项（写清做不到的）

| # | 风险 / 做不到 | 影响 | 处置 |
|---|---|---|---|
| 1 | **红票无法可靠自动判定**：`RecognizeGeneralInvoice` 不返回红票标记（已核实 `VatInvoiceInfo`/`VatElectronicInfo` 字段表），且文档未承诺 OCR 会保留负号 | 红票可能被当正常票入库，合计偏大 | 启发式（§5.5）+ admin 手工改 + 记 `status_source`；**界面在"合计"旁常注"含冲红 N 张"**，让人一眼看到口径 |
| 2 | **不做真伪核验**：没接 `VatInvoiceVerifyNew`。系统只能保证"这张图上是这些字"，不能保证"这张票是真的" | 假票/废票会进台账 | 明确写在界面说明里；v2 再评估（核验需销方税号、当日票不支持、单张日查 5 次，且按次计费） |
| 3 | **OFD 数电票不支持**：`RecognizeGeneralInvoice` 只收 PNG/JPG/PDF，OFD 要走 `VerifyOfdVatInvoiceOCR` | 用户从电子税务局下载的 OFD 传不上来 | 上传框 `accept` 只列 `.pdf,.jpg,.jpeg,.png`，并在文案里写「OFD 请先另存为 PDF」；不做静默失败 |
| 4 | **PDF >7.5MB 无法识别**（10MB 是 base64 后上限）；没有可靠的 Node 端 PDF 瘦身库 | 大 PDF 直接失败 | 41301 文案给具体值：「这个 PDF 有 9.2MB，识别上限约 7.5MB，先压缩或拆页」；**不做"自动拆 PDF"**，那需要额外依赖且会打乱页码 |
| 5 | **图片需要压缩才能识别**：手机拍的发票常 4–10MB | 不压缩就超限 | 用已在依赖里的 `sharp`：长边 >4000px 缩到 4000，JPEG q=82，逐轮降到 q=60 / 长边 2000，直到 base64 ≤9.5MB；压缩后会**降低小字识别率**，所以只在超限时才压，并把"已压缩"写进 `warnings` |
| 6 | **扫描件倾斜 / 复印模糊 / 盖章遮挡导致识别失败或串位** | 字段错、金额错 | 失败 → 42208 让人重传；成功的也可能串位 → 容差判定标黄 + `ocrRaw` 留原文可回溯。**不能承诺 100% 正确**，这是 OCR 的物理边界 |
| 7 | **纸质票同号不同代码** | 只按号码判重会误吞 | 唯一键取 `(invoice_code, invoice_no)`；查询判重时对 `invoice_code` 为空的行放宽匹配（§5.2 注） |
| 8 | **中文文件名在 Win7/旧版资源管理器可能乱码**（bit11 被忽略，按 GBK 解） | 用户看到方块字 | 我们按标准写 UTF-8 + bit11：Win10 1903+ / Win11 / 7-Zip / WinRAR / macOS 全正常。文档与界面说明一句：「如遇乱码，用 7-Zip 解压」；**代价**：不为老系统退回 GBK 编码（那会让 Mac/Linux 全乱） |
| 9 | **批量上传无服务端队列**：浏览器关掉就中断 | 后面的文件不会上传，界面看不出哪些没做 | 逐文件结果列表 + 「重试失败项」按钮；已成功的已入库，不会重复（判重兜底） |
| 10 | **单包 ZIP 上限 500 份 / 2GB** | 一次下不完 | 41301 带实际值 + 建议筛小范围；不做分卷（分卷 ZIP 在 Windows 资源管理器的体验很差） |
| 11 | **一张发票被多份合同引用** | 删合同不影响发票（`CASCADE` 只删边），删发票会让合同侧关联消失 | 发票软删后关联保留，合同详情里标灰并提示"这张票已被删除，可恢复" |
| 12 | 合同状态"手工任意切换"没有状态机 | 能从「已结算」直接跳回「签订中」 | 这是业务方明确要求（他们就是会改主意）；只在 `updated_at` 与操作日志里留痕，不加拦截 |

---

## 13. ADR 摘要（三条，五段式；后续可拆成 `docs/decisions/ADR-*.md`）

### ADR-001 发票识别选 `RecognizeGeneralInvoice`（通用票据高级版）

- **状态**：已接受（2026-11-16，业务方已确认"用腾讯云 OCR"）
- **背景**：要识别 PDF/JPG/PNG 三种来源的多种发票；客户已有腾讯云账号（对象存储在用）。
- **决定**：用 `RecognizeGeneralInvoice` + `ImageBase64`，只收 `Type ∈ {3,16}`。
- **后果**：一次调用覆盖专票/普票/电子/全电，不用按票种分接口；代价是**没有红票标记**（要人工兜底）、**OFD 不支持**、单张 base64 ≤10MB。QPS 5 决定前端并发只能给 3。
- **关联**：ADR-003；§5.5、§12-1/3/4。

### ADR-002 ZIP 用 `yazl`，store 模式

- **状态**：已接受
- **背景**：批量下载当前查询结果，单包可能上千份、数 GB；部署环境是 Node runtime，可能只有 512MB–1GB 内存。
- **决定**：`yazl@3.3.1`，`compress: false`，`addReadStreamLazy` 逐条流式，平铺目录，UTF-8 + bit11。
- **后果**：常量内存、CPU 近零；包体比压缩大约 2%–5%；不设 `Content-Length`（浏览器显示未知大小）。放弃 `archiver`（依赖多、能力过剩）与 `adm-zip`（会 OOM）。
- **关联**：§6；复用 `export.service.ts` 的 `contentDisposition`。

### ADR-003 冲红统一归一为负数 + 人工可改

- **状态**：已接受（业务方确认"入库统一为负数，统计直接求和"）
- **背景**：红票与蓝票并存，合计必须能直接 `SUM`；而 OCR 不给红票标记、也不保证给负号。
- **决定**：入库时按启发式判定并把三项取负；`status_source` 记来源；admin 可改，改时同步重定符号。
- **后果**：统计只有一条口径（直接求和），列表显示负号；代价是**首次入库可能判错**，必须靠人看「含冲红 N 张」这句提示去复核。若以后接真伪核验，`RedLetterInvoiceMark` 可以替换启发式，`status_source` 会变成 `verify`，契约不用改。
- **关联**：§5.5；§7（仅 admin 可改）。

---

## 14. 术语（三行一条：人话 / 决定 / 代价）

```
[术语] 价税合计（total_amount）
[人话] 发票上"一共多少钱"——不含税金额加上税额
[决定] 单独一列存，不与 amount+tax 合并；三者关系由容差函数校验，不靠数据库约束
[代价] 中：三个数不一致时要人来判断（标黄），系统不替你决定哪个对

[术语] 冲红（status = red）
[人话] 开错了的票作废重开，钱数要抵掉，所以记成负数
[决定] 状态与符号绑在一起：改状态就改符号，两件事一次做完
[代价] 高：符号一改，所有合计都变；所以只有管理员能动

[术语] 全电发票（数电票）
[人话] 税务局新推的电子发票，号码是 20 位，没有"发票代码"
[决定] 号码取 Number，代码存空串；判重靠 (code,no) 的联合唯一
[代价] 中：纸质票与全电票的号码规则不同，判重逻辑要能同时吃两种

[术语] 幂等（关联合同）
[人话] 同一次关联点两下，不会出现两条一样的记录
[决定] contract_invoices 复合主键 + ON CONFLICT DO NOTHING，返回 linked 布尔值
[代价] 低：前端不需要防抖，也不需要先查后写
```
