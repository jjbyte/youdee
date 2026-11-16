-- 发票管理：invoices / invoice_files / contract_invoices + contracts.status
--
-- 手写 SQL（Prisma 只按序执行，不做 diff）。三处顺序易错，见每段前的注释：
--   1) contracts.status：先回填 → 再设默认 → 最后 NOT NULL
--   2) invoices.invoice_code 必须 NOT NULL DEFAULT ''（唯一索引不认 NULL 相等）
--   3) 金额允许负数（冲红），只卡绝对上限
--
-- 为什么唯一键是 (invoice_code, invoice_no) 而不是 invoice_no：
--   纸质票的 8 位号码在**不同发票代码**下会重复。只按号码判重，会把不同供应商的
--   两张真票当成同一张跳过——用户看到的是"我明明传了 20 张，怎么只有 18 张"，
--   而且被吞掉的那两张永远不会出现在任何错误提示里。
--   而全电票没有发票代码，用空串兜（唯一索引对 NULL 不生效，多行 NULL 互不冲突）。

-- ── 1) contracts.status ─────────────────────────────────────────────
-- 顺序不能反：先回填再设默认。反了（先 SET DEFAULT 再 UPDATE）不会报错，
-- 但语义上会让"存量回填成履约中"这件事看起来像是默认值干的，
-- 半年后没人敢改这个默认值。
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status varchar(20);
UPDATE contracts SET status = 'performing' WHERE status IS NULL;      -- 存量一律「履约中」（业务方确认）
ALTER TABLE contracts ALTER COLUMN status SET DEFAULT 'negotiating';  -- 新建默认「签订中」
ALTER TABLE contracts ALTER COLUMN status SET NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status);
ALTER TABLE contracts ADD CONSTRAINT contracts_status_valid
  CHECK (status IN ('negotiating','performing','settling','settled','terminated'));

COMMENT ON COLUMN contracts.status IS '合同状态：negotiating 签订中 / performing 履约中 / settling 结算中 / settled 已结算 / terminated 已终止；写入路径只有 PATCH /contracts/:id/status';

-- ── 2) invoices ─────────────────────────────────────────────────────
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 发票号码：全电 20 位 / 纸质 8 位。规范化后只保留数字与大写字母
  invoice_no        varchar(32) NOT NULL,
  -- 发票代码：纸质票 10/12 位；全电票为空 → 空串，不是 NULL（见文件头）
  invoice_code      varchar(20) NOT NULL DEFAULT '',
  -- 业务状态，与 deleted_at 正交：冲红是业务状态，删除是可见性
  status            varchar(10) NOT NULL DEFAULT 'normal',
  -- 状态来源：ocr 自动判定 / manual 人工改过。人工改过的不再被重传覆盖
  status_source     varchar(10) NOT NULL DEFAULT 'ocr',
  invoice_type      varchar(40) NOT NULL DEFAULT 'Unknown',
  invoice_type_label varchar(60) NOT NULL,
  -- 开票日期：OCR 认不出时留空，不拿上传日冒充
  issued_on         date,
  buyer_name        varchar(200) NOT NULL DEFAULT '',
  buyer_tax_no      varchar(30),
  seller_name       varchar(200) NOT NULL DEFAULT '',
  seller_tax_no     varchar(30),
  -- 三个金额列都可空：没认出来的金额就空着，不能拿 0 冒充；
  -- 冲红为负，所以只卡绝对值上限，不卡符号
  amount            numeric(14,2),
  tax_amount        numeric(14,2),
  total_amount      numeric(14,2),
  -- ok / derived（由另两项推算）/ mismatch（|amount+tax-total| > 0.01）
  amount_check      varchar(10) NOT NULL DEFAULT 'ok',
  -- OCR 原始响应里与本票相关的那一段：口径变了能回溯，不必再花一次钱重识别
  ocr_raw           jsonb,
  ocr_request_id    varchar(64),
  remark            text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now(),
  -- 软删：票是凭据，误删可恢复；物理原件不动，由周任务按引用计数回收
  deleted_at        timestamptz(3)
);

COMMENT ON TABLE invoices IS '发票台账。一张票一行，字段以「财务能拿去对账」为准';
COMMENT ON COLUMN invoices.invoice_code IS '发票代码：纸质票 10/12 位；全电票与多数电子票为空串（不是 NULL，唯一索引不认 NULL 相等）';
COMMENT ON COLUMN invoices.status IS 'normal 正常 / red 冲红；与金额符号绑定，冲红为负';
COMMENT ON COLUMN invoices.status_source IS 'ocr 自动判定 / manual 人工改过；manual 不再被重传覆盖';
COMMENT ON COLUMN invoices.amount IS '不含税金额（元）；冲红为负；空表示未识别，不是 0';
COMMENT ON COLUMN invoices.amount_check IS 'ok 三项自洽 / derived 由另两项推算 / mismatch 三项差超 0.01 元（界面标黄）';
COMMENT ON COLUMN invoices.ocr_raw IS 'OCR 原始响应中与本票相关的一段（jsonb），口径变更时回溯用';
COMMENT ON COLUMN invoices.ocr_request_id IS '腾讯云 RequestId，找腾讯云对账时要用';

-- 唯一键：同一张票不能录两遍，但不同来源的同号票不会被误吞
CREATE UNIQUE INDEX invoices_code_no_key ON invoices (invoice_code, invoice_no);
-- 只给号码的精确查询（含 invoice_code='' 的全电票）
CREATE INDEX invoices_invoice_no_idx ON invoices (invoice_no);
-- 默认排序：开票日期倒序（没日期的排最后），再按录入时间兜底
CREATE INDEX invoices_issued_on_idx ON invoices (issued_on DESC);
CREATE INDEX invoices_status_idx ON invoices (status);
CREATE INDEX invoices_deleted_at_idx ON invoices (deleted_at);
CREATE INDEX invoices_created_at_idx ON invoices (created_at DESC);
-- 购买方 / 销售方模糊查询本轮**不建**索引：ILIKE '%x%' 用不上 btree，
-- pg_trgm 的 GIN 在 ≤7 万行时反而更慢（索引扫描 + 回表）。
-- 阈值：行数 >5 万 或 列表 P95 >400ms 时，加
--   CREATE EXTENSION pg_trgm; CREATE INDEX invoices_buyer_trgm ON invoices USING gin (buyer_name gin_trgm_ops);

ALTER TABLE invoices ADD CONSTRAINT invoices_amount_range
  CHECK (total_amount IS NULL OR (total_amount > -1e12 AND total_amount < 1e12));
ALTER TABLE invoices ADD CONSTRAINT invoices_status_valid CHECK (status IN ('normal','red'));
ALTER TABLE invoices ADD CONSTRAINT invoices_status_source_valid CHECK (status_source IN ('ocr','manual'));
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_check_valid
  CHECK (amount_check IN ('ok','derived','mismatch'));

-- ── 3) invoice_files ────────────────────────────────────────────────
CREATE TABLE invoice_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- local 本地磁盘 / cos 腾讯云对象存储。按行分流，不靠"当前设置"反推
  storage       varchar(10) NOT NULL DEFAULT 'local',
  storage_key   varchar(300) NOT NULL,
  url           varchar(1000) NOT NULL,
  original_name varchar(200) NOT NULL,
  mime          varchar(120) NOT NULL,
  -- bigint：与 contract_files 同型，避免以后再改
  size_bytes    bigint NOT NULL,
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoice_files IS '发票原件（PDF / JPG / PNG）。同一份物理文件可被多行引用（多页 PDF 识别出多张票时共用一份）';
COMMENT ON COLUMN invoice_files.storage_key IS 'local 时是 UPLOAD_DIR 下的相对路径；cos 时是对象键（不含桶名）';
COMMENT ON COLUMN invoice_files.size_bytes IS '字节数；ZIP 打包要用它做 yazl 的尺寸校验（能抓出"库里 3MB、盘上 0 字节"）';

CREATE INDEX invoice_files_invoice_id_idx ON invoice_files (invoice_id);
-- 物理回收按 storage_key 反查引用数：查不到引用才是真孤儿
CREATE INDEX invoice_files_storage_key_idx ON invoice_files (storage_key);

-- ── 4) contract_invoices ────────────────────────────────────────────
CREATE TABLE contract_invoices (
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  -- 复合主键 = 幂等键：同一次关联点两下不会出现两条一样的记录（ON CONFLICT DO NOTHING）
  PRIMARY KEY (contract_id, invoice_id)
);

COMMENT ON TABLE contract_invoices IS '合同 ↔ 发票。多对多：一张合同常挂多张进项票，一张票也可能被多个项目合同引用';

-- 复合主键的前导列已覆盖 contract_id；这里补反向（按发票查挂了哪些合同）
CREATE INDEX contract_invoices_invoice_id_idx ON contract_invoices (invoice_id);
