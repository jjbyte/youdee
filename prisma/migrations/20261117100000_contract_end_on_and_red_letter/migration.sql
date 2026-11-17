-- 0.1.39
-- ① 合同终止日期：填了就是周期性合同（年 / 季度），到期前一个月工作台提醒管理员。
--    老合同一律为 NULL = 非周期性，不做任何回填——「到期日」这件事没法从别的字段猜。
ALTER TABLE "contracts" ADD COLUMN "end_on" date;
CREATE INDEX "contracts_end_on_idx" ON "contracts"("end_on");

-- ② 「这张票是不是红字票」与「这张票有没有被冲红」拆成两列。
--    0.1.38 及以前合成一列（status=red 同时表示负数与"改过了"），
--    于是红字票入账 + 原票标已冲红会让同一对票翻两次符号，合计变成 -2X 而不是 0。
ALTER TABLE "invoices" ADD COLUMN "is_red_letter" boolean NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN "original_invoice_no" varchar(32);
CREATE INDEX "invoices_original_invoice_no_idx" ON "invoices"("original_invoice_no");

-- 存量回填：旧口径下 status='red' 且金额为负的行，其实就是「红字票」本身。
-- 转成 is_red_letter=true + status='normal'（红字票是一张正常凭证），
-- 三项金额一个都不动，所以合计不变。金额非负的 status='red' 行留在原处，
-- 它的含义在新口径下仍然成立：蓝票被人工标成了「已冲红」。
UPDATE "invoices"
   SET "is_red_letter" = true,
       "status" = 'normal'
 WHERE "status" = 'red'
   AND ("amount" < 0 OR "tax_amount" < 0 OR "total_amount" < 0);
