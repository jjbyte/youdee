-- 合同管理：公司合同台账 + 扫描件
--
-- 为什么合同不进报价单：一张合同底下可能有多张报价单，而报价单也常常在
-- 合同之前就出了（框架客户先干活、后补签）。把合同塞进 quotes 会让
-- 「这单有没有合同」变成一个既不是状态也不是版本的东西。
--
-- 扫描件单独一张表，一个合同可以挂多份（正文 / 附件 / 补充协议）：
-- 现实里续签和补签都是往同一份合同上再加一页，不新建一个合同。

CREATE TABLE contracts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 合同编号：不是每份合同都有编号，允许空
  contract_no  varchar(60),
  title        varchar(200) NOT NULL,
  -- 签约公司。这是查得最多的一个维度，所以单列 + trgm 索引，不塞进备注
  company_name varchar(120) NOT NULL,
  project_name varchar(200),
  signed_on    date,
  amount       numeric(14,2),
  note         text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz(3) NOT NULL DEFAULT now(),
  -- 软删：合同是凭据，真删一次等于把一份扫描件从台账里抹掉，而扫描件是客户
  -- 手里那份的唯一副本时，找不回来。
  deleted_at   timestamptz(3),
  CONSTRAINT contracts_amount_nonneg CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT contracts_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT contracts_company_not_blank CHECK (length(btrim(company_name)) > 0)
);

COMMENT ON COLUMN contracts.company_name IS '签约公司名称（甲方口径），列表按它查询';
COMMENT ON COLUMN contracts.project_name IS '项目名称；同一公司可能有多个项目的合同';
COMMENT ON COLUMN contracts.signed_on IS '签订日期；未知时留空，不要用建单日冒充';
COMMENT ON COLUMN contracts.amount IS '合同金额（元）；空表示未记录，不表示 0';
COMMENT ON COLUMN contracts.deleted_at IS '软删时间；非空即不再出现在默认列表里';

-- 默认列表顺序：签订时间倒序；没填签订日期的排在后面，但不能被永远藏掉
CREATE INDEX contracts_signed_on_idx ON contracts (signed_on DESC NULLS LAST);
CREATE INDEX contracts_created_at_idx ON contracts (created_at DESC);
CREATE INDEX contracts_deleted_idx ON contracts (deleted_at);
-- 三个查询维度都要支持「输一半也能查到」，用 trigram 而不是 btree 前缀
CREATE INDEX contracts_company_trgm_idx ON contracts USING gin (company_name gin_trgm_ops);
CREATE INDEX contracts_project_trgm_idx ON contracts USING gin (project_name gin_trgm_ops);
CREATE INDEX contracts_title_trgm_idx ON contracts USING gin (title gin_trgm_ops);

CREATE TABLE contract_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind          varchar(20) NOT NULL CHECK (kind IN ('image','file')),
  storage_key   varchar(300) NOT NULL,
  url           varchar(1000) NOT NULL,
  original_name varchar(200),
  mime          varchar(60),
  size_bytes    integer,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);

COMMENT ON TABLE contract_files IS '合同扫描件（PDF / 图片）；一个合同可挂多份';
COMMENT ON COLUMN contract_files.storage_key IS 'var/uploads 下的相对路径，物理文件由清理任务回收';

CREATE INDEX contract_files_contract_idx ON contract_files (contract_id, sort_order, created_at);
