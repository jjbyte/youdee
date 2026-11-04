/** GET 全量巡检：每个只读端点真实调一次，记录状态码，抓 500。 */
import fs from 'node:fs';
import path from 'node:path';

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
  return { status: res.status, json, text };
}

// 统计 route 文件数与导出方法
const root = 'src/app/api/v1';
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'route.ts') files.push(p);
  }
})(root);
const methods = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const ms = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
  methods[f.replace(/\\/g, '/')] = ms;
}
const allMethods = Object.values(methods).flat();
console.log(`route 文件数=${files.length} 端点方法数=${allMethods.length}  (GET ${allMethods.filter((m) => m === 'GET').length} / POST ${allMethods.filter((m) => m === 'POST').length} / PATCH ${allMethods.filter((m) => m === 'PATCH').length} / DELETE ${allMethods.filter((m) => m === 'DELETE').length})`);

await call('POST', '/auth/login', { login: 'admin', password: PWD });

const items = (await call('GET', '/items?limit=100')).json.data.items;
const material = items.find((i) => i.name.includes('桁架背景板'));
const personnel = items.find((i) => i.item_type === 'personnel') ?? items[0];
const prices = (await call('GET', '/prices?limit=5')).json.data.items;
const quotes = (await call('GET', '/quotes?limit=5')).json.data.items;
const suppliers = (await call('GET', '/suppliers?limit=5')).json.data.items;
const cats = (await call('GET', '/categories?domain=material')).json.data;
const users = (await call('GET', '/users')).json.data.items;
const notes = (await call('GET', '/notifications?limit=5')).json.data.items;

const catId = (Array.isArray(cats) ? cats[0] : cats.items?.[0])?.id;
const quoteWithItems = quotes.find((q) => q.item_count > 0) ?? quotes[0];

const probes = [
  ['GET', '/health'],
  ['GET', '/auth/me'],
  ['GET', '/items?limit=3'],
  ['GET', '/items?item_type=personnel&limit=3'],
  ['GET', `/items/${material.id}`],
  ['GET', `/items/${personnel.id}`],
  ['GET', `/items/search-lite?q=桁架`],
  ['GET', `/items/${material.id}/compare?qty_base=18&tax_basis=inclusive`],
  ['GET', `/items/${material.id}/price-trend`],
  ['GET', '/units'],
  ['GET', '/suppliers?limit=3'],
  ['GET', `/suppliers/${suppliers[0].id}`],
  ['GET', '/categories?domain=material'],
  ['GET', '/categories?domain=personnel'],
  ['GET', `/categories/${catId}`],
  ['GET', '/prices?limit=3'],
  ['GET', '/prices/expiring?mode=stale&limit=3'],
  ['GET', `/prices/${prices[0].id}`],
  ['GET', `/prices/${prices[0].id}/history`],
  ['GET', `/price-lookup?item_id=${material.id}&qty=18&pricing_nature=custom_made&tax_basis=inclusive`],
  ['GET', '/quotes?limit=3'],
  ['GET', '/quotes/summary?group_by=project_type'],
  ['GET', `/quotes/${quotes[0].id}`],
  ['GET', `/quotes/${quotes[0].id}/items`],
  ['GET', `/quotes/${quoteWithItems.id}/risk-check`],
  ['GET', '/dashboard/summary'],
  ['GET', '/settings/company'],
  ['GET', '/settings/quote'],
  ['GET', '/notifications?limit=3'],
  ['GET', '/notifications/unread-count'],
  ['GET', '/users'],
];

let bad = 0;
for (const [m, p] of probes) {
  const r = await call(m, p);
  const okFlag = r.status >= 200 && r.status < 300;
  if (!okFlag) bad += 1;
  const summary = r.json ? `code=${r.json.code}${r.json.message ? ' msg=' + String(r.json.message).slice(0, 60) : ''}` : (r.text ?? '').slice(0, 60);
  console.log(`${okFlag ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(3)} ${m} ${p}  ${summary}`);
}
console.log(`\n巡检完成：${probes.length} 个只读端点，异常 ${bad} 个`);
console.log('users 抽样:', users.slice(0, 3).map((u) => `${u.login}/${u.role}`).join(' | '));
console.log('通知抽样:', notes.slice(0, 2).map((n) => `${n.kind}:${n.title}`).join(' | '));
