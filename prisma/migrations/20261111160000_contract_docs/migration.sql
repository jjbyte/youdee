-- 合同管理补齐：乙方、附件分类、关联系统报价单

-- 1) 客户名称（乙方）
--    与 company_name（甲方 = 我方签约主体）分开存。合成一列会让"我们签给谁"
--    和"谁签给我们"永远分不清，而合同台账恰恰是按这两边各查一遍。
ALTER TABLE contracts ADD COLUMN customer_name varchar(120);
COMMENT ON COLUMN contracts.customer_name IS '客户名称（乙方）；与 company_name（甲方）分列，两个方向各自可查';

CREATE INDEX contracts_customer_trgm_idx ON contracts USING gin (customer_name gin_trgm_ops);
CREATE INDEX contracts_contract_no_idx ON contracts (contract_no);

-- 2) 附件分类
--    三类文件在现实里是三个抽屉：合同正文（法律凭据）、报价单（商务依据）、
--    结算资料（对账凭据）。混在一个列表里，找结算单的人得翻完整份合同目录。
ALTER TABLE contract_files ADD COLUMN category varchar(20) NOT NULL DEFAULT 'contract';
ALTER TABLE contract_files ADD CONSTRAINT contract_files_category_check
  CHECK (category IN ('contract', 'quote', 'settlement'));
COMMENT ON COLUMN contract_files.category IS '附件分类：contract 合同电子版 / quote 报价单电子版 / settlement 结算资料';

-- 老数据全部落在 contract（默认值），无需回填
CREATE INDEX contract_files_category_idx ON contract_files (contract_id, category, sort_order, created_at);

-- 3) 合同 ↔ 系统报价单
--    用关联表而不是 contracts.quote_id：一张合同底下常常挂着多张报价单
--    （分阶段报价、改版、补项），单列只能记住最后一张，前面几张等于丢了。
--    这里**不建**到 quotes 的外键约束删除动作，而是 ON DELETE SET NULL 做不到
--    （联合主键两列），所以选择 CASCADE：报价单被真删，关联行跟着消失即可，
--    合同本身和它的电子版附件不受影响（合同不靠报价单存在）。
CREATE TABLE contract_quotes (
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  quote_id    uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, quote_id)
);

COMMENT ON TABLE contract_quotes IS '合同关联的系统报价单；多对多，一张合同可挂多张报价单';
COMMENT ON COLUMN contract_quotes.created_by IS '谁建的关联；删关联时用来追责';

-- 反向查：从一张报价单看它被哪份合同引用
CREATE INDEX contract_quotes_quote_idx ON contract_quotes (quote_id);
