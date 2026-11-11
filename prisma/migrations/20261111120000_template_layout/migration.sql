-- 报价单模板支持上传 Excel 定制版式（列顺序 / 表头文案 / 抬头排布）
--
-- layout 存的是**解析后的结构化 JSON**，不是 xlsx 二进制：
--   JSON 可以逐字段校验、可以 diff、可以跟着单据快照走；
--   xlsx 一旦 Excel 版本变了就得重解析，而且没法在服务端做字段白名单。
-- 原始文件另存在 source_file，只用于「重新解析」和「下载检查」，不参与渲染。
--
-- quotes.template_layout 是建单时的快照：模板改了、删了，历史单重打还是原版式。
-- 与 template_supplier_name 同一条原则——报价单是快照，不是视图。

ALTER TABLE quote_templates
  ADD COLUMN IF NOT EXISTS layout jsonb,
  ADD COLUMN IF NOT EXISTS source_file text;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS template_layout jsonb;

COMMENT ON COLUMN quote_templates.layout IS 'Excel 解析出的版式定义；NULL 表示用系统默认版式';
COMMENT ON COLUMN quote_templates.source_file IS '上传的原始 xlsx 路径（仅存档，不参与渲染）';
COMMENT ON COLUMN quotes.template_layout IS '建单时的版式快照；NULL 表示默认版式';
