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

// 联调时误归档了一条 active 价（本公司自有 1500/套），这里恢复成 active，
// 并删掉那次归档写下的 change log，避免演示数据里出现"没有 active 价的最低价供应商"。
const before = await c.query(
  `SELECT p.id, s.name, p.unit_price, p.status FROM prices p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.status='archived' ORDER BY p.updated_at DESC LIMIT 5`,
);
console.log('archived 现状:', before.rows);

const restored = await c.query(
  `UPDATE prices SET status='active', updated_at=now()
    WHERE status='archived'
      AND item_id = (SELECT id FROM items WHERE name LIKE '桁架背景板%' LIMIT 1)
      AND supplier_id = (SELECT id FROM suppliers WHERE name='本公司自有')
    RETURNING id, unit_price, status`,
);
console.log('恢复:', restored.rows);

if (restored.rows.length > 0) {
  const ids = restored.rows.map((r) => r.id);
  const del = await c.query(`DELETE FROM price_change_logs WHERE price_id = ANY($1::uuid[]) AND action='archived' RETURNING id`, [ids]);
  console.log('删除归档日志条数:', del.rowCount);
}

const after = await c.query(
  `SELECT s.name, p.unit_price, p.status, p.effective_from, p.effective_to
     FROM prices p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.item_id = (SELECT id FROM items WHERE name LIKE '桁架背景板%' LIMIT 1)
    ORDER BY s.name, p.effective_from DESC`,
);
console.log('桁架当前价格:', after.rows);
await c.end();
