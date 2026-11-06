-- ============================================================
-- 报价单模板（多抬头）
--
-- 背景：客户版抬头原来只有一套，供应商名称写死在页脚里。
-- 实际业务里同一批物料要报给不同主体，「客户名称」由单据带出，
-- 「供应商名称」由模板决定 —— 于是抬头需要一个可选、可并存、可追溯的来源。
--
-- 快照规则与 tax_statement 一致：建单时把 supplier_name 复制到
-- quotes.template_supplier_name，之后改模板**不回头改历史单**。
-- 报价单是快照，不是视图；否则上个月发出去的 PDF 和今天重打的不是同一份。
-- ============================================================

CREATE TABLE quote_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(60)  NOT NULL,
  -- 允许空串：公司抬头还没填时，模板可以先建出来，抬头那一格显示「—」
  supplier_name varchar(120) NOT NULL DEFAULT '',
  is_default    boolean      NOT NULL DEFAULT false,
  is_active     boolean      NOT NULL DEFAULT true,
  sort_order    integer      NOT NULL DEFAULT 100,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  updated_at    timestamptz(3) NOT NULL DEFAULT now()
);

-- 模板名唯一且大小写不敏感：两个「默认模板」并列时，建单的人一定会选错
CREATE UNIQUE INDEX quote_templates_name_key ON quote_templates (lower(name));
-- 全库只允许一个默认模板：新建单不选的时候要有一个确定的落点
CREATE UNIQUE INDEX quote_templates_single_default ON quote_templates ((is_default)) WHERE is_default;

ALTER TABLE quotes ADD COLUMN template_id uuid REFERENCES quote_templates(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN template_supplier_name varchar(120);
CREATE INDEX quotes_template_id_idx ON quotes (template_id);

-- 种子：一个「默认模板」，供应商名取现有的公司抬头
INSERT INTO quote_templates (name, supplier_name, is_default)
SELECT '默认模板',
       COALESCE((SELECT value->>'name' FROM app_settings WHERE key = 'company_profile'), ''),
       true;

-- 历史单回填：模板指向默认模板，供应商名快照成公司抬头。
-- 不回填的话，昨天刚发出去的单重打一次会少一行「供应商名称」——同一份文件两个样子。
UPDATE quotes
   SET template_id = (SELECT id FROM quote_templates WHERE is_default),
       template_supplier_name = (SELECT supplier_name FROM quote_templates WHERE is_default)
 WHERE template_id IS NULL;

-- 报价有效期天数：原来界面写死 30 天且不落库，这里只是把已有值补齐成 30，
-- 之后由 app_settings.quote_valid_days_default 这个键控制（不建行也能读到默认值）。
