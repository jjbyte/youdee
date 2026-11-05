-- 供应商开票信息（客户要求：编辑页面增加纳税人识别号、公司地址、联系电话、开户银行、账号等可选字段）
--
-- 五列全部 nullable，不做回填：这五项是"用得到才有"的事实，编不出来。
-- 用 ADD COLUMN 而不动 contact_phone —— 「联系人手机」和「发票上那个电话」是两件事：
-- 前者是找到这个人，后者是税务局认的号。合成一列，迟早有人把私人手机号开进发票。

ALTER TABLE suppliers
  ADD COLUMN tax_no          varchar(30),
  ADD COLUMN company_address varchar(200),
  ADD COLUMN company_phone   varchar(30),
  ADD COLUMN bank_name       varchar(100),
  ADD COLUMN bank_account    varchar(50);

COMMENT ON COLUMN suppliers.tax_no          IS '纳税人识别号（15–20 位字母数字），可选';
COMMENT ON COLUMN suppliers.company_address IS '开票地址，可选';
COMMENT ON COLUMN suppliers.company_phone   IS '开票电话（与 contact_phone 的「联系人手机」不是一回事），可选';
COMMENT ON COLUMN suppliers.bank_name       IS '开户银行，可选';
COMMENT ON COLUMN suppliers.bank_account    IS '银行账号（只存数字，空格与横杠在入口处去掉），可选';
