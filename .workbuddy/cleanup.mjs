/** 收尾：把联调造的 380 按天租赁价归档（不硬删，保留审计），让桁架回到种子的 1 组 3 家 */
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';

async function call(method, p, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const rc = sc.find((c) => c.startsWith('rc_session='));
  if (rc) { const q = rc.split(';')[0]; if (q.length > 11) cookie = q; }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json };
}

await call('POST', '/auth/login', { login: 'admin', password: PWD });
const items = (await call('GET', '/items?item_type=material&limit=100')).json.data.items;
const truss = items.find((i) => i.name.includes('桁架背景板'));
const prices = (await call('GET', `/prices?item_id=${truss.id}&limit=20`)).json.data.items;
const rental = prices.find((p) => p.pricing_nature === 'rental_per_day' && p.status === 'active' && p.unit_price === '380.0000');
if (rental) {
  const r = await call('POST', `/prices/${rental.id}/archive`, {});
  console.log(`归档 380 按天租赁价 -> HTTP ${r.status} code=${r.json?.code}`);
} else {
  console.log('没有需要归档的联调租赁价');
}

const cmp = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=inclusive`);
const g = cmp.json.data.groups;
console.log(`compare 组数=${g.length}`);
for (const x of g) console.log(`  ${x.pricing_nature}/${x.pricing_mode ?? 'null'} comparable=${x.comparable} rows=${x.rows.length} 最低=${x.lowest_base_unit_price}`);
