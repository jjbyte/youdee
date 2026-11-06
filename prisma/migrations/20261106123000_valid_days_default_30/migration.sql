-- 报价有效期默认值 15 → 30
--
-- 背景：app_settings.quote_valid_days_default 这个键种子里写的是 15，但从来没人读过它——
-- 设置页把 30 写死在界面上（还是只读），新建单也按 30 天算。也就是说系统实际一直在用 30，
-- 库里那个 15 是死配置。现在这一项改成可编辑了，如果还读 15，界面上会突然从 30 变 15，
-- 报价员会以为系统出错了。
--
-- 只改仍等于 15 的行：已经有人明确改成别的值就不动它。
UPDATE app_settings
   SET value = '30'::jsonb, updated_at = now()
 WHERE key = 'quote_valid_days_default'
   AND value = '15'::jsonb;
