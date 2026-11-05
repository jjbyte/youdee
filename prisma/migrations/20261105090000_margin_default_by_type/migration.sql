-- 按项目类型的「默认毛利率」：建单初值 + 换类型时同步单头毛利率。
--
-- 与 warn_rate 是两件事，名字必须能分开：
--   warn_rate            预警线（低于它变琥珀色，只影响颜色，永不拦出单）
--   default_margin_rate  默认毛利率（反推对客价的入参：售价 = 成本 ÷ (1 − 毛利率)）
-- 把两者合成一个数，等于让「安全线」变成「报价」，客户报出去的价格会正好压在自己的
-- 警告线上——那是最难解释的一种毛利下滑。
--
-- 可为空：留空 = 这个类型没有默认值，沿用单头现有的毛利率/留空由人填。
-- 不做 NOT NULL DEFAULT 0.35 之类的兜底：那会让管理员没配过的类型悄悄按我们的猜测报价。

ALTER TABLE margin_thresholds
  ADD COLUMN default_margin_rate numeric(5,4)
  CHECK (default_margin_rate IS NULL OR (default_margin_rate > 0 AND default_margin_rate < 1));

-- 回填存量行：占位值 = 预警线 + 10 个点（上限 95%）。
-- 不填的话，升级上来的库在设置页看到的是一列空白，客户当场就会再报一次
-- 「选了类型毛利率还是没变」——而这恰好是这次要修的那个问题。
-- 为什么是 +10 个点：预警线是"低于它就要提醒"的地板，报出去的价压在地板上
-- 本身就是一种持续亏损；10 个点是让初值站在地板之上，且不虚构一个精确数字。
UPDATE margin_thresholds
   SET default_margin_rate = LEAST(warn_rate + 0.10, 0.95)
 WHERE default_margin_rate IS NULL;

COMMENT ON COLUMN margin_thresholds.default_margin_rate IS
  '该类型新单的默认毛利率（反推对客价用）；NULL = 不设默认';
COMMENT ON COLUMN margin_thresholds.warn_rate IS
  '该类型的毛利预警线；低于它只变色，永不拦截出单';
