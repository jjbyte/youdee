/** 用一张新建草稿确认 refresh-prices / tax-basis preview 的真实返回体 */
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
  return { status: res.status, json, text };
}

await call('POST', '/auth/login', { login: 'admin', password: PWD });
const items = (await call('GET', '/items?item_type=material&limit=100')).json.data.items;
const truss = items.find((i) => i.name.includes('桁架背景板'));
const priceRow = (await call('GET', `/prices?item_id=${truss.id}&limit=1`)).json.data.items[0];

const q = await call('POST', '/quotes', {
  customer_name: '临时草稿客户', event_name: '临时草稿活动',
  valid_until: day(7), project_type: 'roadshow', target_margin_rate: '0.4',
});
const qid = q.json.data.id;
console.log('草稿', q.json.data.quote_no, 'target_margin_rate=', q.json.data.target_margin_rate);

await call('POST', `/quotes/${qid}/items`, {
  line_kind: 'material', qty: '18', cost_source: 'price_book',
  item_id: truss.id, price_id: priceRow.id,
});
await call('POST', `/quotes/${qid}/items`, {
  line_kind: 'personnel', qty: '1', cost_source: 'manual',
  item_name_snapshot: '手填行', unit_snapshot: '人/天', cost_unit_price: '500.00', sale_unit_price: '900.00',
});

const dry = await call('POST', `/quotes/${qid}/refresh-prices`, { dry_run: true });
console.log(`\nrefresh-prices -> HTTP ${dry.status} code=${dry.json?.code}`);
console.log(JSON.stringify(dry.json, null, 1).slice(0, 700));

const tp = await call('POST', `/quotes/${qid}/tax-basis/preview`, { tax_statement: 'exclusive' });
console.log(`\ntax-basis/preview -> HTTP ${tp.status} code=${tp.json?.code}`);
console.log(JSON.stringify(tp.json, null, 1).slice(0, 900));

const am = await call('POST', `/quotes/${qid}/apply-target-margin`, {});
console.log(`\napply-target-margin -> HTTP ${am.status} code=${am.json?.code} 合计=${am.json?.data?.quote_totals?.total_price} margin=${am.json?.data?.quote_totals?.margin_rate}`);
console.log(`  行1 对客=${am.json?.data?.items?.[0]?.sale_unit_price ?? am.json?.data?.item?.sale_unit_price ?? '-'}`);

const del = await call('DELETE', `/quotes/${qid}`);
console.log(`\n清理草稿 -> HTTP ${del.status} code=${del.json?.code}`);
