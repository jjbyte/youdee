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

const ITEM = `(SELECT id FROM items WHERE name LIKE '桁架背景板%' LIMIT 1)`;
const SUP = `(SELECT id FROM suppliers WHERE name='本公司自有')`;

const logs = await c.query(
  `SELECT l.id, l.price_id, l.action, l.changed_at, u.name AS by
     FROM price_change_logs l LEFT JOIN users u ON u.id=l.changed_by
    WHERE l.price_id IN (SELECT id FROM prices WHERE item_id=${ITEM} AND supplier_id=${SUP})
    ORDER BY l.changed_at DESC`,
);
console.log('改价日志:', logs.rows);

// 完全回滚联调对种子价造成的改动：删掉联调新增的 1500 价与其日志，
// 把 1450 恢复成 open-ended active（与 seed 一致），并删掉那次 superseded 日志。
const created = await c.query(
  `SELECT id FROM prices WHERE item_id=${ITEM} AND supplier_id=${SUP} AND unit_price=1500.0000`,
);
const newIds = created.rows.map((r) => r.id);
console.log('联调新增价:', newIds);

if (newIds.length) {
  await c.query(`DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[])`, [newIds]);
  await c.query(`DELETE FROM price_tiers WHERE price_id = ANY($1::uuid[])`, [newIds]);
  await c.query(`DELETE FROM price_attachments WHERE price_id = ANY($1::uuid[])`, [newIds]);
  await c.query(`DELETE FROM prices WHERE id = ANY($1::uuid[])`, [newIds]);
}

await c.query(
  `UPDATE prices SET status='active', effective_to=NULL, updated_at=now()
    WHERE item_id=${ITEM} AND supplier_id=${SUP} AND unit_price=1450.0000`,
);
await c.query(
  `DELETE FROM price_change_logs WHERE price_id IN
     (SELECT id FROM prices WHERE item_id=${ITEM} AND supplier_id=${SUP} AND unit_price=1450.0000)
   AND action IN ('superseded','archived')`,
);

const after = await c.query(
  `SELECT s.name, p.unit_price, p.status, p.effective_from, p.effective_to
     FROM prices p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.item_id=${ITEM} ORDER BY s.name, p.effective_from DESC`,
);
console.log('恢复后桁架价格:', after.rows);
await c.end();
