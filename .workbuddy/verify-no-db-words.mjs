/** 验响应体里没有数据库内部术语（constraint / violation / 23P01 / prisma） */
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
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return {}; } })() };
}
const bad = /constraint|violation|23P01|prisma|SQLSTATE/i;
await call('POST', '/auth/login', { login: 'admin', password: 'youdee2026' });

const cases = [
  ['重名供应商 40901', await call('POST', '/suppliers', { name: '本公司自有', type: 'factory' })],
  ['重名分类 40901', await call('POST', '/categories', { domain: 'material', name: 'KT 板' })],
  ['单价为负 40001', await call('POST', '/prices', { item_id: '00000000-0000-0000-0000-000000000000', unit_price: '-1' })],
  ['不存在的报价单 40401', await call('GET', '/quotes/00000000-0000-0000-0000-000000000000')],
  ['未登录 40101', await (async () => { const keep = cookie; cookie = ''; const r = await call('GET', '/items'); cookie = keep; return r; })()],
];
for (const [label, r] of cases) {
  const dirty = bad.test(r.text) ? '含数据库术语（不合格）' : '干净';
  console.log(`${label} -> HTTP ${r.status} code=${r.json.code} ${dirty}\n    ${r.text.slice(0, 150)}`);
}
