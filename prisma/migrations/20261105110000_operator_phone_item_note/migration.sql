-- 0.1.17：报价单抬头显示操作人员电话；物料库 / 人员库增加备注
--
-- 两处都是**可空新增列**，不动任何已有数据：
--   users.phone   —— 只给客户看的那一个号（印在报价单抬头），不是登录/找回密码用的手机
--   items.note    —— 物料与人员共用一张表，所以一列覆盖两个库
--
-- 为什么不把电话挂在 app_settings 的公司信息上：
--   公司电话是"打给公司"，报价人电话是"打给做这张单的人"。一张单发出后客户要问的是
--   "这个桁架是几米的"，接电话的必须是当初报价的那个人。合成一个号码，客户打过去
--   报出单号，接电话的同事还得再转一次——那就等于没做这件事。

ALTER TABLE users ADD COLUMN phone varchar(30);

ALTER TABLE items ADD COLUMN note text;

COMMENT ON COLUMN users.phone IS '报价人联系电话，显示在报价单抬头；与登录账号无关';
COMMENT ON COLUMN items.note IS '物料 / 人员备注。录进报价单时作为该行备注的初值，改行内备注只影响那张单';

-- 备注要能搜到才有用：报价员记得的是"那个写着含运输的桁架"，不是物料的完整名字
CREATE INDEX items_note_trgm_idx ON items USING gin (note gin_trgm_ops);
