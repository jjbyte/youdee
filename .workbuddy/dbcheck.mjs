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
const r = await c.query(
  `SELECT p.id, s.name AS supplier, p.unit_code, p.unit_mode, p.base_unit_qty, p.unit_price,
          p.tax_included, p.pricing_nature, p.effective_from, p.effective_to, p.status,
          i.compare_unit_code, i.base_unit_code
     FROM prices p JOIN suppliers s ON s.id=p.supplier_id JOIN items i ON i.id=p.item_id
    WHERE i.name LIKE '桁架背景板%' ORDER BY s.name`,
);
console.log(r.rows);
const t = await c.query(`SELECT price_id, min_qty, unit_price FROM price_tiers WHERE price_id = ANY($1::uuid[]) ORDER BY min_qty`, [r.rows.map((x) => x.id)]);
console.log(t.rows);
await c.end();
