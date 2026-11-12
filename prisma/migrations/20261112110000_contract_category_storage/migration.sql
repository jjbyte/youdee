-- 合同分类 + 附件存储位置 + 附件体积放宽
--
-- 三件事一次做完，因为它们都是"合同附件"这条链上的：
--
-- 1) contracts.category：商业 / 租赁 / 雇佣三类。**默认 commercial 并立即 NOT NULL**，
--    而不是先留空再让界面兜——历史合同已经在用，留空的话筛选"商业合同"会漏掉
--    所有老数据，用户会以为数据丢了。回填成 commercial 是这里唯一安全的选择。
--
-- 2) contract_files.storage：local | cos。旧附件全在本地磁盘上，回填 local；
--    之后新传的按设置里的存储方式走。读取接口据此分流，不迁移存量文件。
--
-- 3) size_bytes 从 integer 提到 bigint：integer 上限 2147483647 字节（约 2GB），
--    而"附件不再限制单份大小"之后，超 2GB 的文件会在插库时 22003 崩掉，
--    报错和"上传"看起来毫无关系。bigint 之后上限是 9EB，够用到底。

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS category varchar(20);
UPDATE contracts SET category = 'commercial' WHERE category IS NULL;
ALTER TABLE contracts ALTER COLUMN category SET DEFAULT 'commercial';
ALTER TABLE contracts ALTER COLUMN category SET NOT NULL;

CREATE INDEX IF NOT EXISTS contracts_category_idx ON contracts (category);

COMMENT ON COLUMN contracts.category IS '合同分类：commercial 商业 / lease 租赁 / employment 雇佣';

ALTER TABLE contract_files ADD COLUMN IF NOT EXISTS storage varchar(10);
UPDATE contract_files SET storage = 'local' WHERE storage IS NULL;
ALTER TABLE contract_files ALTER COLUMN storage SET DEFAULT 'local';
ALTER TABLE contract_files ALTER COLUMN storage SET NOT NULL;

COMMENT ON COLUMN contract_files.storage IS '文件实际存放位置：local 本地 UPLOAD_DIR / cos 腾讯云对象存储';
COMMENT ON COLUMN contract_files.storage_key IS 'local 时是 UPLOAD_DIR 下的相对路径；cos 时是对象键（不含桶名）';

ALTER TABLE contract_files ALTER COLUMN size_bytes TYPE bigint;
