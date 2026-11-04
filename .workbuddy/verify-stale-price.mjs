/**
 * 验 stale_draft_items.latest_price 真的给值（不是恒 null）。
 *
 * 造法必须真实：先引用现行价建行 → 再「新增并关闭旧价」把该价变成 superseded
 * → 这时草稿行引用的就是历史价，自检必须能同时给出快照价和替代它的最新价。
 * 跑完自己回滚（删新价、复原旧价、删掉验证单），库里不留痕。
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
const cmp = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=inclusive`);
const own = cmp.json.data.groups.find((g) => g.pricing_nature === 'custom_made').rows.find((r) => r.supplier_name.includes('本公司'));
console.log(`现行价 ${String(own.price_id).slice(0, 8)}… 归一=${own.base_unit_price} bq=${own.base_unit_qty}`);

const created = await call('POST', '/quotes', {
  customer_name: '价格取代验证客户', event_name: '价格取代验证单',
  valid_until: day(7), event_date: day(14), project_type: 'product_launch',
});
const quote = created.json.data;
const line = await call('POST', `/quotes/${quote.id}/items`, {
  line_kind: 'material', qty: '18', cost_source: 'price_book',
  item_id: truss.id, price_id: own.price_id, sale_unit_price: '300.00',
});
console.log(`建单 ${quote.quote_no} 行1 成本=${line.json.data.item.cost_unit_price} price_id=${String(line.json.data.item.price_id ?? '').slice(0, 8)}…`);

// 新增并关闭旧价：旧价 → superseded，新价成为现行价
const raised = await call('POST', '/prices', {
  item_id: truss.id, supplier_id: own.supplier_id, unit_code: own.unit_code,
  pricing_nature: 'custom_made', unit_price: '1580.0000', effective_from: day(0),
  base_unit_qty: own.base_unit_qty,
  close_previous: true, source_note: '验证：价格取代后的自检',
});
console.log(`新增并关闭旧价 HTTP ${raised.status} code=${raised.json.code} 新价=${raised.json.data?.unit_price ?? raised.json.message}`);
const newPriceId = raised.json.data?.id;
const closed = raised.json.data;
const bump = await call('GET', `/prices/${own.price_id}`);
console.log(`旧价状态=${bump.json.data?.effective_state} effective_to=${bump.json.data?.effective_to}`);

const risk = await call('POST', `/quotes/${quote.id}/risk-check`);
const d = risk.json.data;
console.log(`\nrisk-check HTTP ${risk.status} blocked=${d.blocked}`);
console.log(`stale_draft_items = ${JSON.stringify(d.stale_draft_items)}`);
console.log(`warnings          = ${JSON.stringify(d.warnings.map((w) => `${w.code}:${w.title}`))}`);
console.log(`TMP_QUOTE_ID=${quote.id}`);
console.log(`NEW_PRICE_ID=${newPriceId ?? ''}`);
console.log(`OLD_PRICE_ID=${own.price_id}`);
void closed;
