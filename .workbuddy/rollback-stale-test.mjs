/** 回滚 verify-stale-price 的副作用：删新价、复原被关闭的旧价、删验证单 */
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

// 1) 验证造出来的新价（1580）连同审计日志
const np = await c.query(`SELECT id FROM prices WHERE source_note = '验证：价格取代后的自检'`);
const ids = np.rows.map((r) => r.id);
if (ids.length) {
  await c.query('DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[])', [ids]);
  await c.query('DELETE FROM price_tiers WHERE price_id = ANY($1::uuid[])', [ids]);
  await c.query('DELETE FROM price_attachments WHERE price_id = ANY($1::uuid[])', [ids]);
  await c.query('DELETE FROM prices WHERE id = ANY($1::uuid[])', [ids]);
}
console.log('删除验证新价', ids.length, '条');

// 2) 复原被「新增并关闭旧价」关掉的种子价（1450 那条）
const old = await c.query(
  `UPDATE prices p SET status = 'active', effective_to = NULL, updated_at = now()
     FROM items i
    WHERE i.id = p.item_id AND i.name LIKE '桁架背景板%'
      AND p.pricing_nature = 'custom_made' AND p.unit_price = 1450
      AND p.status = 'superseded'
    RETURNING p.id`,
);
console.log('复原种子价', old.rowCount, '条');

// 3) 复原时顺手清掉「被取代」那条审计日志（它记录的是一个已经不存在的事实）
const sp = await c.query(
  `DELETE FROM price_change_logs WHERE action = 'superseded'
     AND price_id IN (SELECT p.id FROM prices p JOIN items i ON i.id = p.item_id
                       WHERE i.name LIKE '桁架背景板%' AND p.unit_price = 1450)
    RETURNING id`,
);
console.log('删除被取代审计日志', sp.rowCount, '条');

// 4) 验证单（002 起的都是脚本造的，种子只有 001）
const qs = await c.query(`SELECT id, quote_no FROM quotes WHERE quote_no >= 'YD-202611-002'`);
for (const q of qs.rows) {
  await c.query('DELETE FROM notifications WHERE quote_id = $1', [q.id]);
  await c.query('DELETE FROM quote_items WHERE quote_id = $1', [q.id]);
  await c.query('DELETE FROM quotes WHERE id = $1', [q.id]);
  console.log('删除验证单', q.quote_no);
}

// 5) 计数器回落
const maxNo = await c.query(
  `SELECT COALESCE(MAX(split_part(quote_no, '-', 3)::int), 0) AS n FROM quotes WHERE quote_no LIKE 'YD-202611-%'`,
);
await c.query(`UPDATE counters SET value = $1 WHERE key = 'quote_no:202611'`, [Number(maxNo.rows[0].n)]);
console.log('计数器回落至', maxNo.rows[0].n);

await c.query('COMMIT');
const counts = await c.query(`SELECT
  (SELECT count(*) FROM quotes) quotes,
  (SELECT count(*) FROM quote_items) quote_items,
  (SELECT count(*) FROM items) items,
  (SELECT count(*) FROM prices) prices,
  (SELECT count(*) FROM price_change_logs) logs`);
console.log('当前计数', JSON.stringify(counts.rows[0]));
await c.end();
