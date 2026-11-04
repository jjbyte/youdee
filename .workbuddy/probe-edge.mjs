/** 两个边界：引用已归档价的报价行、图片删除 */
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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
const all = (await call('GET', `/prices?item_id=${truss.id}&limit=20`)).json.data.items;
const archived = all.find((p) => p.status === 'archived');
console.log('已归档价:', archived ? `${archived.id.slice(0, 8)} ${archived.unit_price} ${archived.pricing_nature}` : '无');

const q = await call('POST', '/quotes', {
  customer_name: '边界测试客户', event_name: '边界测试活动', valid_until: day(5),
});
const qid = q.json.data.id;
const line = await call('POST', `/quotes/${qid}/items`, {
  line_kind: 'material', qty: '18', cost_source: 'price_book',
  item_id: truss.id, price_id: archived.id, sale_unit_price: '260.00',
});
console.log(`行引用已归档价 -> HTTP ${line.status} code=${line.json?.code} msg=${line.json?.message ?? ''} 行=${line.json?.data?.item?.item_name_snapshot} 成本=${line.json?.data?.item?.cost_unit_price} price_missing=${line.json?.data?.item?.price_missing}`);

const noPrice = await call('POST', `/quotes/${qid}/items`, {
  line_kind: 'material', qty: '18', cost_source: 'price_book',
  item_id: truss.id, pricing_nature: 'service', sale_unit_price: '260.00',
});
console.log(`行只给 item+nature 但该性质无价 -> HTTP ${noPrice.status} code=${noPrice.json?.code} msg=${String(noPrice.json?.message ?? '').slice(0, 90)}`);

const manualNoCost = await call('POST', `/quotes/${qid}/items`, {
  line_kind: 'custom', qty: '1', cost_source: 'manual', item_name_snapshot: '无成本行', unit_snapshot: '项',
});
console.log(`手填但不给成本 -> HTTP ${manualNoCost.status} code=${manualNoCost.json?.code} msg=${String(manualNoCost.json?.message ?? '').slice(0, 90)}`);

// 出单必须被 blocker 拦住
const issue = await call('POST', `/quotes/${qid}/issue`);
console.log(`有行无成本时出单 -> HTTP ${issue.status} code=${issue.json?.code} msg=${String(issue.json?.message ?? '').slice(0, 120)}`);
const rk = await call('GET', `/quotes/${qid}/risk-check`);
console.log(`   risk-check blocked=${rk.json?.data?.blocked} blockers=${(rk.json?.data?.blockers ?? []).map((b) => b.code).join(',')}`);

await call('DELETE', `/quotes/${qid}`);

// 图片删除
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+g6wAAAAASUVORK5CYII=', 'base64');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 't.png');
const up = await fetch(`${BASE}/items/${truss.id}/images`, { method: 'POST', headers: { cookie }, body: fd });
const upJson = await up.json();
const del = await call('DELETE', `/items/${truss.id}/images/${upJson.data.id}`);
console.log(`DELETE 图片 -> HTTP ${del.status} code=${del.json?.code}（应为 200）`);
const del2 = await call('DELETE', `/items/${truss.id}/images/${upJson.data.id}`);
console.log(`重复 DELETE 同一图片 -> HTTP ${del2.status} code=${del2.json?.code}（应为 40401）`);
