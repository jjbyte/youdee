/**
 * 清掉联调过程中通过 API 造出来的行（幂等，只碰我自己造的那些）。
 * 种子数据一行不动：报价单只保留 YD-202611-001，价格只保留种子那几条。
 */
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
await c.query('BEGIN');

// 1) 联调造的报价单（种子只有 YD-202611-001，002 起的都是脚本造的）
const qs = await c.query(`SELECT id, quote_no FROM quotes WHERE quote_no >= 'YD-202611-002'`);
for (const q of qs.rows) {
  await c.query('DELETE FROM notifications WHERE quote_id = $1', [q.id]);
  await c.query('DELETE FROM quote_items WHERE quote_id = $1', [q.id]);
  await c.query('DELETE FROM quotes WHERE id = $1', [q.id]);
  console.log('删除联调报价单', q.quote_no);
}

// 2) 联调造的按天租赁价（种子里桁架没有租赁价，这条一定是我加的）
//    审计日志是 ON DELETE RESTRICT，必须先删日志再删价
const rpIds = await c.query(
  `SELECT p.id FROM prices p JOIN items i ON i.id = p.item_id
    WHERE i.name LIKE '桁架背景板%' AND p.pricing_nature = 'rental_per_day'`,
);
const rpList = rpIds.rows.map((r) => r.id);
if (rpList.length) {
  await c.query('DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[])', [rpList]);
  await c.query('DELETE FROM price_tiers WHERE price_id = ANY($1::uuid[])', [rpList]);
  await c.query('DELETE FROM price_attachments WHERE price_id = ANY($1::uuid[])', [rpList]);
  await c.query('DELETE FROM prices WHERE id = ANY($1::uuid[])', [rpList]);
}
console.log('删除联调租赁价', rpList.length, '条');

// 3) 联调 PATCH 备注留下的审计日志（净变更为零，留着会污染种子价的轨迹）
const lg = await c.query(`DELETE FROM price_change_logs WHERE action = 'note_updated' RETURNING id`);
console.log('删除联调审计日志', lg.rowCount, '条');

// 4) 还原被 PATCH 改过的备注
const rs = await c.query(
  `UPDATE prices SET source_note = NULL
    WHERE source_note = '联调：允许改的字段' RETURNING id`,
);
console.log('还原备注', rs.rowCount, '条');

// 5) 单号计数器回落到现存最大单号，避免演示时下一单从 011 开始
const maxNo = await c.query(
  `SELECT COALESCE(MAX(split_part(quote_no, '-', 3)::int), 0) AS n
     FROM quotes WHERE quote_no LIKE 'YD-202611-%'`,
);
await c.query(`UPDATE counters SET value = $1 WHERE key = 'quote_no:202611'`, [Number(maxNo.rows[0].n)]);
console.log('计数器回落至', maxNo.rows[0].n);

await c.query('COMMIT');

const counts = await c.query(`SELECT
  (SELECT count(*) FROM quotes) quotes,
  (SELECT count(*) FROM quote_items) quote_items,
  (SELECT count(*) FROM items) items,
  (SELECT count(*) FROM prices) prices,
  (SELECT count(*) FROM notifications) notifications,
  (SELECT count(*) FROM price_change_logs) logs`);
console.log('当前计数', JSON.stringify(counts.rows[0]));
await c.end();
