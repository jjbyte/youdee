-- ============================================================
-- 有底 初始化迁移
-- 契约来源：docs/04-Spec.md §6 / docs/02-ARCHITECTURE.md §7
--
-- 这份 SQL 是手写的，不是 prisma migrate dev 生成的。原因：
--   1) EXCLUDE USING gist（价格区间不重叠）Prisma Schema DSL 表达不了
--   2) unit_mode 是生成列，Prisma 表达不了
--   3) 部分索引、CHECK 约束、append-only 权限
-- Prisma Client 由 schema.prisma 生成，两者字段必须一一对应。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── 单位字典 ────────────────────────────────────────────────
CREATE TABLE units (
  code        varchar(20) PRIMARY KEY,
  name_zh     varchar(20) NOT NULL,
  kind        varchar(20) NOT NULL CHECK (kind IN ('material','personnel','common')),
  is_time     boolean     NOT NULL,
  sort_order  integer     NOT NULL,
  note        text
);

-- ── 用户 ────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login         varchar(40)  NOT NULL UNIQUE,
  password_hash varchar(200) NOT NULL,
  name          varchar(40)  NOT NULL,
  role          varchar(20)  NOT NULL CHECK (role IN ('admin','member')),
  is_active     boolean      NOT NULL,
  token_version integer      NOT NULL,
  last_login_at timestamptz(3),
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);

-- ── 供应商 ──────────────────────────────────────────────────
CREATE TABLE suppliers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   varchar(80) NOT NULL UNIQUE,
  type                   varchar(20) NOT NULL
                           CHECK (type IN ('online','factory','rental','freelancer','internal')),
  contact_name           varchar(30),
  contact_phone          varchar(30),
  shop_url               varchar(500),
  region                 varchar(50),
  default_lead_time_days integer,
  note                   text,
  is_active              boolean NOT NULL,
  created_at             timestamptz(3) NOT NULL DEFAULT now(),
  updated_at             timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_type_idx ON suppliers (type);
CREATE INDEX suppliers_active_idx ON suppliers (is_active);

-- ── 分类（双域两棵树，最多两级）────────────────────────────
CREATE TABLE categories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                  varchar(20) NOT NULL CHECK (domain IN ('material','personnel')),
  name                    varchar(30) NOT NULL,
  parent_id               uuid REFERENCES categories(id) ON DELETE RESTRICT,
  sort_order              integer NOT NULL,
  -- 录价表单的默认交易性质：只预填，不进唯一键、不进取价候选集
  default_pricing_nature  varchar(20)
                            CHECK (default_pricing_nature IN ('purchase','rental_per_day','custom_made','service')),
  created_at              timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX categories_tree_idx ON categories (domain, parent_id, sort_order);
CREATE UNIQUE INDEX categories_sibling_unique ON categories (domain, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- ── 计价主体（物料 + 人员统一）──────────────────────────────
CREATE TABLE items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type         varchar(20) NOT NULL CHECK (item_type IN ('material','personnel')),
  category_id       uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name              varchar(80) NOT NULL,
  aliases           text[] NOT NULL DEFAULT '{}',
  spec              varchar(200),
  base_unit_code    varchar(20) NOT NULL REFERENCES units(code) ON DELETE RESTRICT,
  compare_unit_code varchar(20) REFERENCES units(code) ON DELETE RESTRICT,
  includes_travel   boolean,
  is_active         boolean NOT NULL,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX items_type_active_idx ON items (item_type, is_active);
CREATE INDEX items_category_idx ON items (category_id);
CREATE INDEX items_name_trgm_idx ON items USING gin (name gin_trgm_ops);

CREATE TABLE item_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  storage_key varchar(300) NOT NULL,
  url         varchar(1000) NOT NULL,
  label       varchar(60),
  width       integer,
  height      integer,
  sort_order  integer NOT NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX item_images_item_idx ON item_images (item_id, sort_order);

CREATE TABLE item_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  url        varchar(1000) NOT NULL,
  label      varchar(60),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX item_links_item_idx ON item_links (item_id);

-- ── 价格（版本化核心）──────────────────────────────────────
CREATE TABLE prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  supplier_id    uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  unit_code      varchar(20) NOT NULL REFERENCES units(code) ON DELETE RESTRICT,
  -- 1 个比价基准单位 = N 个本价格单位（乘法口径）。NULL = 未填 = 不可比。
  -- 严禁 NOT NULL DEFAULT 1：那会把"我不知道"静默变成"我断言 1:1"。
  base_unit_qty  numeric(12,6),
  unit_price     numeric(12,4) NOT NULL,
  currency       varchar(3) NOT NULL,
  tax_included   boolean NOT NULL,
  -- NOT NULL 是 EXCLUDE 约束有效性的前提，不得改为可空：
  -- 若为 NULL，NULL = NULL 为假，约束对人员整段静默失效且不报错。
  pricing_nature varchar(20) NOT NULL
                   CHECK (pricing_nature IN ('purchase','rental_per_day','custom_made','service')),
  tax_rate       numeric(6,4),
  moq            numeric(10,2),
  effective_from date NOT NULL,
  effective_to   date,
  status         varchar(20) NOT NULL CHECK (status IN ('active','superseded','archived')),
  source_note    varchar(200),
  last_used_at   timestamptz(3),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  updated_at     timestamptz(3) NOT NULL DEFAULT now(),
  -- 生成列：按什么计价。只有时间类单位有值，其余归并为 NULL。
  -- 归并是刻意的：sqm 与 sheet 是同一个价的两种写法，若分成 per_sqm/per_sheet，
  -- EXCLUDE 会允许"同供应商同期并存㎡价与张价"，取价变成不可预期。
  unit_mode text GENERATED ALWAYS AS (
    CASE unit_code
      WHEN 'day'        THEN 'per_day'
      WHEN 'session'    THEN 'per_event'
      WHEN 'person_day' THEN 'per_person_day'
      WHEN 'hour'       THEN 'per_hour'
      WHEN 'half_day'   THEN 'per_half_day'
      ELSE NULL
    END
  ) STORED,
  CONSTRAINT prices_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT prices_base_unit_qty_positive CHECK (base_unit_qty IS NULL OR base_unit_qty > 0),
  CONSTRAINT prices_price_nonneg CHECK (unit_price >= 0)
);

-- ★ 价格区间不重叠：六维唯一，数据库层强制，并发安全
ALTER TABLE prices ADD CONSTRAINT prices_no_overlap
  EXCLUDE USING gist (
    item_id        WITH =,
    supplier_id    WITH =,
    pricing_nature WITH =,
    tax_included   WITH =,
    COALESCE(unit_mode, '') WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (status <> 'archived');

CREATE INDEX prices_item_status_idx ON prices (item_id, status);
CREATE INDEX prices_supplier_idx ON prices (supplier_id);
CREATE INDEX prices_effective_from_idx ON prices (effective_from);
CREATE INDEX prices_last_used_idx ON prices (last_used_at);
-- 取当前有效价的覆盖索引
CREATE INDEX prices_lookup_idx ON prices (item_id, supplier_id, pricing_nature, effective_from DESC)
  WHERE status <> 'archived';

CREATE TABLE price_tiers (
  price_id   uuid NOT NULL REFERENCES prices(id) ON DELETE CASCADE,
  min_qty    numeric(10,2) NOT NULL,
  unit_price numeric(12,4) NOT NULL,
  PRIMARY KEY (price_id, min_qty),
  CONSTRAINT price_tiers_min_positive CHECK (min_qty > 0),
  CONSTRAINT price_tiers_price_nonneg CHECK (unit_price >= 0)
);

CREATE TABLE price_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_id      uuid NOT NULL REFERENCES prices(id) ON DELETE CASCADE,
  kind          varchar(20) NOT NULL CHECK (kind IN ('image','file')),
  storage_key   varchar(300) NOT NULL,
  url           varchar(1000) NOT NULL,
  original_name varchar(200),
  mime          varchar(60) CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes    integer CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 5242880)),
  label         varchar(60),
  note          text,
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX price_attachments_price_idx ON price_attachments (price_id);

-- append-only 变更日志
CREATE TABLE price_change_logs (
  id            bigserial PRIMARY KEY,
  price_id      uuid NOT NULL REFERENCES prices(id) ON DELETE RESTRICT,
  action        varchar(30) NOT NULL
                  CHECK (action IN ('created','superseded','archived','restored','note_updated')),
  snapshot      jsonb NOT NULL,
  prev_snapshot jsonb,
  changed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at    timestamptz(3) NOT NULL DEFAULT now(),
  note          text
);
CREATE INDEX price_logs_price_idx ON price_change_logs (price_id, changed_at DESC);
CREATE INDEX price_logs_time_idx ON price_change_logs (changed_at DESC);

-- ── 报价单 ──────────────────────────────────────────────────
CREATE TABLE quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no             varchar(30) NOT NULL,
  version              integer NOT NULL CHECK (version >= 1),
  derived_from_quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  customer_name        varchar(80) NOT NULL,
  event_name           varchar(120) NOT NULL,
  event_date           date,
  valid_until          date NOT NULL,
  status               varchar(20) NOT NULL CHECK (status IN ('draft','issued','void')),
  -- 项目类型决定毛利预警线。不做自由文本：自由文本会让"按类型统计毛利"永久失效。
  project_type         varchar(30)
                         CHECK (project_type IN ('annual_meeting','product_launch','exhibition_booth','roadshow','framework_client')),
  currency             varchar(3) NOT NULL,
  target_margin_rate   numeric(5,4) CHECK (target_margin_rate IS NULL OR (target_margin_rate > -1 AND target_margin_rate < 1)),
  discount_amount      numeric(14,2) NOT NULL DEFAULT 0,
  total_cost           numeric(14,2) NOT NULL DEFAULT 0,
  total_price          numeric(14,2) NOT NULL DEFAULT 0,
  total_profit         numeric(14,2) NOT NULL DEFAULT 0,
  margin_rate          numeric(6,4) NOT NULL DEFAULT 0,
  min_line_margin      numeric(6,4),
  tax_statement        varchar(20) NOT NULL CHECK (tax_statement IN ('inclusive','exclusive')),
  note                 text,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  updated_at           timestamptz(3) NOT NULL DEFAULT now(),
  issued_at            timestamptz(3),
  deleted_at           timestamptz(3),
  UNIQUE (quote_no, version),
  CONSTRAINT quotes_issued_at_present CHECK (status <> 'issued' OR issued_at IS NOT NULL),
  CONSTRAINT quotes_margin_range CHECK (margin_rate > -100 AND margin_rate < 1)
);
CREATE INDEX quotes_status_time_idx ON quotes (status, created_at DESC);
CREATE INDEX quotes_project_type_idx ON quotes (project_type);
CREATE INDEX quotes_created_idx ON quotes (created_at DESC);
CREATE INDEX quotes_customer_trgm_idx ON quotes USING gin (customer_name gin_trgm_ops);
CREATE INDEX quotes_event_trgm_idx ON quotes USING gin (event_name gin_trgm_ops);
CREATE INDEX quotes_live_idx ON quotes (created_at DESC) WHERE deleted_at IS NULL;

-- 报价单明细：全量快照。金额列 NOT NULL 且无默认值 ——
-- 让"忘记快照"在类型层与 DB 层双重不可能（靠人记得，一定会在第 200 张单上失效）。
CREATE TABLE quote_items (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                   uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order                 integer NOT NULL,
  line_kind                  varchar(20) NOT NULL CHECK (line_kind IN ('material','personnel','custom')),
  pricing_nature             varchar(20),
  item_name_snapshot         varchar(200) NOT NULL,
  spec_snapshot              varchar(200),
  category_snapshot          varchar(60),
  unit_snapshot              varchar(20) NOT NULL,
  supplier_name_snapshot     varchar(80),
  qty                        numeric(10,2) NOT NULL,
  cost_unit_price            numeric(12,4) NOT NULL,
  sale_unit_price            numeric(12,4) NOT NULL,
  line_cost                  numeric(14,2) NOT NULL,
  line_price                 numeric(14,2) NOT NULL,
  line_profit                numeric(14,2) NOT NULL,
  line_margin                numeric(6,4) NOT NULL,
  cost_source                varchar(20) NOT NULL CHECK (cost_source IN ('price_book','manual')),
  price_missing              boolean NOT NULL,
  reference_lowest_price     numeric(12,4),
  reference_lowest_supplier_id uuid,
  tax_included               boolean NOT NULL,
  -- 弱关联：价格/主体被删不影响历史单（ON DELETE SET NULL，不用 RESTRICT —— 否则
  -- 「有一张两年前的报价单引用过」会让一条录错的价永远删不掉，完整性保护做成运维死结）
  item_id                    uuid REFERENCES items(id) ON DELETE SET NULL,
  price_id                   uuid REFERENCES prices(id) ON DELETE SET NULL,
  supplier_id                uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  is_visible_to_customer     boolean NOT NULL,
  note                       text,
  created_at                 timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT qi_qty_nonneg CHECK (qty >= 0),
  CONSTRAINT qi_line_price_identity CHECK (line_price = round(qty * sale_unit_price, 2)),
  CONSTRAINT qi_line_cost_identity  CHECK (line_cost  = round(qty * cost_unit_price, 2)),
  CONSTRAINT qi_line_profit_identity CHECK (line_profit = line_price - line_cost)
);
CREATE INDEX quote_items_quote_idx ON quote_items (quote_id, sort_order);
CREATE INDEX quote_items_item_idx ON quote_items (item_id);

-- ── 通知 ────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       varchar(40) NOT NULL,
  title      varchar(120) NOT NULL,
  body       text,
  quote_id   uuid REFERENCES quotes(id) ON DELETE SET NULL,
  read_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at);

-- ── 设置 / 计数器 / 阈值 ────────────────────────────────────
CREATE TABLE app_settings (
  key        varchar(60) PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE counters (
  key   varchar(40) PRIMARY KEY,
  value integer NOT NULL
);

CREATE TABLE margin_thresholds (
  project_type varchar(30) PRIMARY KEY
                 CHECK (project_type IN ('annual_meeting','product_launch','exhibition_booth','roadshow','framework_client')),
  warn_rate    numeric(5,4) NOT NULL CHECK (warn_rate > 0 AND warn_rate < 1),
  label        varchar(30) NOT NULL,
  sort_order   integer NOT NULL,
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);

-- ── 追加：变更日志只允许 INSERT/SELECT ──────────────────────
-- 生产环境由 DBA 对应用账号执行；本地开发库跳过（应用账号即 owner）。
-- REVOKE UPDATE, DELETE ON price_change_logs FROM app_user;
