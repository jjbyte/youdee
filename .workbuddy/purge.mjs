/** 清理联调遗留数据（只删我自己造的那些行，种子数据一行不动） */
import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();

const log = (...a) => console.log(...a);

// 1) 联调造的报价单（保留最早那张 YD-202611-001 作为演示数据）
const quotes = await c.query(
  `SELECT id, quote_no FROM quotes WHERE quote_no IN ('YD-202611-003','YD-202611-004','YD-202611-005','YD-202611-006','YD-202611-007','YD-202611-008')`,
);
for (const q of quotes.rows) {
  await c.query('DELETE FROM quote_items WHERE quote_id = $1', [q.id]);
  // notifications 用单列 quote_id 指向报价单（ON DELETE SET NULL），不手动删就会留下孤立提醒
  await c.query('DELETE FROM notifications WHERE quote_id = $1', [q.id]);
  await c.query('DELETE FROM quotes WHERE id = $1', [q.id]);
  log('删除联调报价单', q.quote_no);
}

// 2) 联调造的物料 + 它的价格 + 分类 + 供应商
const item = await c.query(`SELECT id FROM items WHERE name = '联调临时物料'`);
for (const r of item.rows) {
  const prices = await c.query('SELECT id FROM prices WHERE item_id = $1', [r.id]);
  const ids = prices.rows.map((p) => p.id);
  if (ids.length) {
    await c.query('DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[])', [ids]);
    await c.query('DELETE FROM price_tiers WHERE price_id = ANY($1::uuid[])', [ids]);
    await c.query('DELETE FROM price_attachments WHERE price_id = ANY($1::uuid[])', [ids]);
    await c.query('DELETE FROM prices WHERE id = ANY($1::uuid[])', [ids]);
  }
  await c.query('DELETE FROM item_images WHERE item_id = $1', [r.id]);
  await c.query('DELETE FROM item_links WHERE item_id = $1', [r.id]);
  await c.query('DELETE FROM items WHERE id = $1', [r.id]);
  log('删除联调物料', r.id);
}
const cat = await c.query(`DELETE FROM categories WHERE name LIKE '联调临时分类%' RETURNING name`);
log('删除联调分类', cat.rows.map((r) => r.name));
const sup = await c.query(`DELETE FROM suppliers WHERE name = '联调临时供应商' RETURNING name`);
log('删除联调供应商', sup.rows.map((r) => r.name));

// 3) 联调造的按天租赁价（已归档）与它的日志
const rental = await c.query(
  `SELECT p.id FROM prices p JOIN items i ON i.id = p.item_id
    WHERE i.name LIKE '桁架背景板%' AND p.pricing_nature = 'rental_per_day'`,
);
const rIds = rental.rows.map((r) => r.id);
if (rIds.length) {
  await c.query('DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[])', [rIds]);
  await c.query('DELETE FROM price_tiers WHERE price_id = ANY($1::uuid[])', [rIds]);
  await c.query('DELETE FROM prices WHERE id = ANY($1::uuid[])', [rIds]);
  log('删除联调租赁价条数', rIds.length);
}

// 4) 联调账号
const u = await c.query(`DELETE FROM users WHERE login IN ('liantiao_tmp','weak_tmp') RETURNING login`);
log('删除联调账号', u.rows.map((r) => r.login));

// 5) 残留图片文件目录不入库，只确认库里干净
const counts = await c.query(`SELECT
  (SELECT count(*) FROM quotes) AS quotes,
  (SELECT count(*) FROM quote_items) AS quote_items,
  (SELECT count(*) FROM items) AS items,
  (SELECT count(*) FROM prices) AS prices,
  (SELECT count(*) FROM suppliers) AS suppliers,
  (SELECT count(*) FROM categories) AS categories,
  (SELECT count(*) FROM users) AS users`);
log('清理后计数:', counts.rows[0]);
await c.end();
