/**
 * 验 risk-check 的两个 DTO 缺口已补（用种子里已有的 superseded 价，不改动任何数据）：
 * ① stale_draft_items.latest_price 不再恒为 null —— 界面「最新 X」不会渲染成空白
 * ② 四个分组数组带 line_indexes —— 界面不会退回用 itemId 当行号（会显示「第 0 行」）
 */
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';

async function call(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const rc = sc.find((c) => c.startsWith('rc_session='));
  if (rc) {
    const p = rc.split(';')[0];
    if (p.length > 11) cookie = p;
  }
  return { status: res.status, json: await res.json() };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

await call('POST', '/auth/login', { login: 'admin', password: PWD });

const list = await call('GET', '/items?item_type=material&limit=100');
const truss = list.json.data.items.find((i) => i.name.includes('桁架背景板'));

// 种子里 金桥桁架厂 有三条：2950/3100 已被 3200 取代
const sup = await call('GET', `/prices?item_id=${truss.id}&status=superseded&limit=10`);
const old = sup.json.data.items.find((p) => p.supplier_name === '金桥桁架厂');
console.log(`引用已取代价 ${String(old.id).slice(0, 8)}… 单价=${old.unit_price} bq=${old.base_unit_qty} state=${old.effective_state}`);

const created = await call('POST', '/quotes', {
  customer_name: 'DTO验证客户',
  event_name: 'DTO 验证单',
  valid_until: day(7),
  event_date: day(14),
  project_type: 'product_launch',
});
const quote = created.json.data;
console.log(`建单 ${quote.quote_no}`);

const l1 = await call('POST', `/quotes/${quote.id}/items`, {
  line_kind: 'material',
  qty: '18',
  cost_source: 'price_book',
  item_id: truss.id,
  price_id: old.id,
  sale_unit_price: '300.00',
});
console.log(`行1（引用已取代价）HTTP ${l1.status} 成本=${l1.json.data?.item?.cost_unit_price} price_missing=${l1.json.data?.item?.price_missing} source=${l1.json.data?.item?.cost_source}`);

const l2 = await call('POST', `/quotes/${quote.id}/items`, {
  line_kind: 'personnel',
  qty: '2',
  cost_source: 'manual',
  item_name_snapshot: '主持人（DTO 验证）',
  unit_snapshot: '人/天',
  cost_unit_price: '1200.00',
  sale_unit_price: '1000.00',
});
console.log(`行2（手填且亏本）HTTP ${l2.status}`);

const risk = await call('POST', `/quotes/${quote.id}/risk-check`);
const d = risk.json.data;
console.log(`\nrisk-check HTTP ${risk.status} blocked=${d.blocked}`);
console.log(`stale_draft_items  = ${JSON.stringify(d.stale_draft_items)}`);
console.log(`negative_margin    = ${JSON.stringify(d.negative_margin_items)}`);
console.log(`zero_price_items   = ${JSON.stringify(d.zero_price_items)}`);
console.log(`price_expiring     = ${JSON.stringify(d.price_expiring)}`);
console.log(`warnings           = ${JSON.stringify(d.warnings.map((w) => `${w.code}:${w.title}`))}`);
console.log(`\nTMP_QUOTE_ID=${quote.id}`);
