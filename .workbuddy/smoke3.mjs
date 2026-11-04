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
cookie = '';
await call('POST', '/auth/login', { login: 'xiaowang', password: PWD });
const memberCk = cookie;

const quotes = await call('GET', '/quotes?limit=5', undefined, adminCk);
const qid = quotes.json.data.items[0].id;
rec(`当前单 ${quotes.json.data.items[0].quote_no} id=${qid.slice(0, 8)}… status=${quotes.json.data.items[0].status}`);

const sum = await call('GET', '/quotes/summary', undefined, adminCk);
const sd = sum.json.data ?? {};
rec(`[F2] /quotes/summary -> HTTP ${sum.status} quote_count=${sd.quote_count} total_price=${sd.total_price} avg_margin=${sd.avg_margin_rate} by_status=${JSON.stringify(sd.by_status)} by_project_type=${JSON.stringify((sd.by_project_type ?? []).map((x) => `${x.project_type ?? 'null'}:${x.quote_count}/warn=${x.warn_rate}/below=${x.below_warn_count}`))} top客户=${sd.top_customers?.[0]?.customer_name ?? '-'}`);

// 客户版 vs 内部版
const ci = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=internal`, { headers: { cookie: adminCk } });
const bi = Buffer.from(await ci.arrayBuffer());
const cc = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=customer`, { headers: { cookie: adminCk } });
const bc = Buffer.from(await cc.arrayBuffer());
rec(`[G] internal HTTP ${ci.status} bytes=${bi.length} disposition=${(ci.headers.get('content-disposition') ?? '').slice(0, 70)}`);
rec(`    customer HTTP ${cc.status} bytes=${bc.length} 两版字节不同=${bi.length !== bc.length}`);

const mi = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=internal`, { headers: { cookie: memberCk } });
rec(`[H] member 导出内部版 -> HTTP ${mi.status} ${(await mi.text()).slice(0, 140)}`);

// 归档：先拿一条 superseded / active 的价
const prices = await call('GET', `/prices?limit=3`, undefined, adminCk);
rec(`[I] GET /prices -> HTTP ${prices.status} total=${prices.json.data.total} 首条=${prices.json.data.items[0]?.supplier_name}/${prices.json.data.items[0]?.status}`);
const target = prices.json.data.items.find((p) => p.status === 'active') ?? prices.json.data.items[0];
const arch = await call('POST', `/prices/${target.id}/archive`, {}, adminCk);
rec(`    admin POST /prices/{id}/archive (${target.supplier_name} ${target.status}) -> HTTP ${arch.status} code=${arch.json.code} message=${arch.json.message ?? ''}`);
const hist = await call('GET', `/prices/${target.id}/history`, undefined, adminCk);
rec(`    GET /prices/{id}/history -> HTTP ${hist.status} 条数=${Array.isArray(hist.json.data) ? hist.json.data.length : (hist.json.data?.items?.length ?? '-')}`);

// member 归档必须 40301
const arch2 = await call('POST', `/prices/${prices.json.data.items[1].id}/archive`, {}, memberCk);
rec(`[I2] member POST /prices/{id}/archive -> HTTP ${arch2.status} code=${arch2.json.code}`);

// 状态流转红线
const issueAgain = await call('POST', `/quotes/${qid}/issue`, undefined, adminCk);
rec(`[J] 重复出单 -> HTTP ${issueAgain.status} code=${issueAgain.json.code} message=${issueAgain.json.message}`);
const patchIssued = await call('PATCH', `/quotes/${qid}`, { customer_name: '改名试试' }, adminCk);
rec(`    PATCH issued 单改客户名 -> HTTP ${patchIssued.status} code=${patchIssued.json.code} message=${patchIssued.json.message}`);
const patchNote = await call('PATCH', `/quotes/${qid}`, { note: '只改备注应当允许' }, adminCk);
rec(`    PATCH issued 单改 note -> HTTP ${patchNote.status} code=${patchNote.json.code}`);

// 空单出单必须 40906
const empty = await call('POST', '/quotes', {
  customer_name: '空单测试客户', event_name: '空单测试活动',
  valid_until: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
}, adminCk);
const issueEmpty = await call('POST', `/quotes/${empty.json.data.id}/issue`, undefined, adminCk);
rec(`[K] 空单出单 -> HTTP ${issueEmpty.status} code=${issueEmpty.json.code} message=${issueEmpty.json.message}`);
await call('DELETE', `/quotes/${empty.json.data.id}`, undefined, adminCk);
rec(`    空单已删除（软删，仅 draft 可删）`);

// 未登录访问
const anon = await fetch(`${BASE}/items?limit=1`);
rec(`[L] 未登录 GET /items -> HTTP ${anon.status} ${(await anon.text()).slice(0, 80)}`);
