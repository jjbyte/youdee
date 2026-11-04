const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';
const rec = (s) => console.log(s);

async function call(method, path, body, ck) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const use = ck !== undefined ? ck : cookie;
  if (use) headers.cookie = use;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const rc = sc.find((c) => c.startsWith('rc_session='));
  if (rc) { const p = rc.split(';')[0]; if (p.length > 11) cookie = p; }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, json, text };
}

await call('POST', '/auth/login', { login: 'admin', password: PWD });
const adminCk = cookie;

const list = await call('GET', '/items?item_type=material&limit=100');
const truss = list.json.data.items.find((i) => i.name.includes('桁架背景板'));
const prices = await call('GET', `/prices?item_id=${truss.id}&limit=10`, undefined, adminCk);
const p = prices.json.data.items.find((x) => x.unit_price === '1450.0000') ?? prices.json.data.items[0];
rec(`目标价 ${p.supplier_name} ${p.unit_price} id=${p.id.slice(0, 8)}…`);

const r1 = await call('PATCH', `/prices/${p.id}`, { unit_price: '999.0000' }, adminCk);
rec(`[FIX1] admin PATCH {unit_price} -> HTTP ${r1.status} code=${r1.json.code} message=${r1.json.message} locked=${JSON.stringify(r1.json.detail?.locked_fields)}`);
const r2 = await call('PATCH', `/prices/${p.id}`, { base_unit_qty: '0.06' }, adminCk);
rec(`[FIX2] admin PATCH {base_unit_qty} -> HTTP ${r2.status} code=${r2.json.code} message=${r2.json.message}`);
const r3 = await call('PATCH', `/prices/${p.id}`, { effective_from: '2026-01-01' }, adminCk);
rec(`[FIX3] admin PATCH {effective_from} -> HTTP ${r3.status} code=${r3.json.code} message=${r3.json.message}`);
const r4 = await call('PATCH', `/prices/${p.id}`, { moq: '2.00', source_note: '合规字段仍可改' }, adminCk);
rec(`[FIX4] admin PATCH {moq,source_note} -> HTTP ${r4.status} code=${r4.json.code} moq=${r4.json.data.moq} note=${r4.json.data.source_note}`);
const r5 = await call('PATCH', `/prices/${p.id}`, { effective_to: '2027-12-31' }, adminCk);
rec(`[FIX5] admin PATCH effective_to 往后延 -> HTTP ${r5.status} code=${r5.json.code} message=${r5.json.message}`);
