-- 附件 mime 列加长：OOXML 的标准 MIME 有 65~71 个字符
--
-- application/vnd.openxmlformats-officedocument.wordprocessingml.document  (71)
-- application/vnd.openxmlformats-officedocument.spreadsheetml.sheet        (65)
--
-- 原来按"图片 / PDF"设计的 varchar(60) 装不下它们，插库时 Postgres 直接抛
-- 22001 value too long，接口表现为 500「服务器开小差了」——上传 Word/Excel
-- 必失败，而错误信息和"格式"毫无关系，很容易被误判成文件本身有问题。
ALTER TABLE contract_files ALTER COLUMN mime TYPE varchar(120);

COMMENT ON COLUMN contract_files.mime IS '服务端按字节判定出的 MIME；OOXML 需要 71 字符，不要缩回 varchar(60)';
