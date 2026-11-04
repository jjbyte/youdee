/** 上传 / 附件 / 图片 + 两个返回结构未知的口径 */
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';
const rec = (s) => console.log(s);

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
  return { status: res.status, json, text };
}

async function upload(p, bytes, name, type, extra) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  const res = await fetch(BASE + p, { method: 'POST', headers: { cookie }, body: fd });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

await call('POST', '/auth/login', { login: 'admin', password: PWD });
const items = (await call('GET', '/items?item_type=material&limit=100')).json.data.items;
const truss = items.find((i) => i.name.includes('桁架背景板'));

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+g6wAAAAASUVORK5CYII=',
  'base64',
);
const ok1 = await upload(`/items/${truss.id}/images`, png, '主图.png', 'image/png', { sort_order: 1 });
rec(`${ok1.status === 201 ? 'ok  ' : 'FAIL'} ${ok1.status} POST /items/{id}/images (png) code=${ok1.json?.code} url=${ok1.json?.data?.url} storage_key=${ok1.json?.data?.storage_key}`);
const imgId = ok1.json?.data?.id;

const bad = await upload(`/items/${truss.id}/images`, Buffer.from('这不是图片，只是文本'), 'fake.png', 'image/png');
rec(`${bad.status === 415 ? 'ok  ' : 'FAIL'} ${bad.status} POST /items/{id}/images (伪造 png) code=${bad.json?.code} msg=${bad.json?.message}`);

const big = await upload(`/items/${truss.id}/images`, Buffer.alloc(6 * 1024 * 1024, 1), 'big.png', 'image/png');
rec(`${big.status === 413 ? 'ok  ' : 'FAIL'} ${big.status} POST /items/{id}/images (6MB) code=${big.json?.code} msg=${big.json?.message}`);

if (imgId) {
  const del = await call('DELETE', `/items/${truss.id}/images/${imgId}`);
  rec(`${del.status === 200 ? 'ok  ' : 'FAIL'} ${del.status} DELETE /items/{id}/images/{iid} code=${del.json?.code}`);
}

// 价格附件（multipart）
const prices = (await call('GET', `/prices?item_id=${truss.id}&limit=3`)).json.data.items;
const att = await upload(`/prices/${prices[0].id}/attachments`, png, '比价截图.png', 'image/png', { label: '联调截图' });
rec(`${att.status === 201 ? 'ok  ' : 'FAIL'} ${att.status} POST /prices/{id}/attachments (multipart) code=${att.json?.code} id=${att.json?.data?.id?.slice(0, 8)} url=${att.json?.data?.url}`);
if (att.json?.data?.id) {
  const d = await call('DELETE', `/prices/${prices[0].id}/attachments/${att.json.data.id}`);
  rec(`${d.status === 200 ? 'ok  ' : 'FAIL'} ${d.status} DELETE /prices/{id}/attachments/{aid} code=${d.json?.code}`);
}

// 两个结构确认
const quotes = (await call('GET', '/quotes?limit=5')).json.data.items;
const draft = quotes.find((q) => q.status === 'draft') ?? quotes[0];
const dry = await call('POST', `/quotes/${draft.id}/refresh-prices`, { dry_run: true });
rec(`\nrefresh-prices 返回键: ${Object.keys(dry.json.data ?? {}).join(',')}`);
rec(`  ${JSON.stringify(dry.json.data).slice(0, 400)}`);

const tp = await call('POST', `/quotes/${draft.id}/tax-basis/preview`, { tax_statement: 'exclusive' });
rec(`tax-basis/preview 返回键: ${Object.keys(tp.json.data ?? {}).join(',')}`);
rec(`  ${JSON.stringify(tp.json.data).slice(0, 500)}`);

const trend = await call('GET', `/items/${truss.id}/price-trend?from=2025-01-01&to=2026-12-31`);
rec(`price-trend 返回键: ${Object.keys(trend.json.data ?? {}).join(',')} series=${trend.json.data?.series?.length ?? '-'}`);
rec(`  ${JSON.stringify(trend.json.data).slice(0, 400)}`);

const exp = await call('GET', '/prices/expiring?mode=stale&limit=2');
rec(`prices/expiring 首条键: ${Object.keys(exp.json.data?.items?.[0] ?? {}).join(',')}`);
