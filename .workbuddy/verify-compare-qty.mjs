/** 复验比价的 qty_priced 口径（修 parseMoney→parseQty 之后） */
const BASE = 'http://127.0.0.1:3010/api/v1';
let cookie = '';
async function call(m, p, b) {
  const h = {};
  if (b !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  const sc = r.headers.getSetCookie?.() ?? [];
  const rc = sc.find((c) => c.startsWith('rc_session='));
  if (rc) { const s = rc.split(';')[0]; if (s.length > 11) cookie = s; }
  return { status: r.status, json: await r.json() };
}
await call('POST', '/auth/login', { login: 'admin', password: 'youdee2026' });
const l = await call('GET', '/items?item_type=material&limit=100');
const t = l.json.data.items.find((i) => i.name.includes('桁架背景板'));
const c = await call('GET', `/items/${t.id}/compare?qty_base=18&tax_basis=inclusive`);
console.log(`HTTP ${c.status} 比价单位=${c.json.data.item.compare_unit_code} qty=${c.json.data.qty}`);
for (const g of c.json.data.groups) {
  console.log(`组[${g.pricing_nature}] 可比=${g.comparable} 最低=${g.lowest_base_unit_price}`);
  for (const r of g.rows) {
    console.log(`   ${r.supplier_name} 单位=${r.unit_code} bq=${r.base_unit_qty} qty_priced=${r.qty_priced} 档价=${r.tier_unit_price} 归一=${r.base_unit_price} tier_min=${r.tier_min_qty}`);
  }
}
