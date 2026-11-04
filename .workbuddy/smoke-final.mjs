/**
 * 最终联调脚本（报告里引用的就是这一轮的真实输出）。
 * 原则：只通过 API 造业务数据，不改种子行。
 */
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ── 1 登录 ────────────────────────────────────────────────────
const login = await call('POST', '/auth/login', { login: 'admin', password: PWD });
const adminCk = cookie;
rec(`[1] POST /auth/login {login:admin} -> HTTP ${login.status} code=${login.json.code} data=${JSON.stringify(login.json.data)} cookie=${adminCk ? 'rc_session=' + adminCk.length + '字节' : '无'}`);

// ── 2 物料列表 ────────────────────────────────────────────────
const list = await call('GET', '/items?item_type=material&limit=100');
const items = list.json.data.items;
rec(`[2] GET /items?item_type=material -> HTTP ${list.status} code=${list.json.code} total=${list.json.data.total} 返回=${items.length}`);
rec(`    名称抽样: ${items.slice(0, 4).map((i) => i.name).join(' | ')}`);

// ── 3 桁架背景板比价 ──────────────────────────────────────────
const truss = items.find((i) => i.name.includes('桁架背景板'));
const cmp = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=inclusive`);
const cd = cmp.json.data;
rec(`[3] GET /items/{桁架}/compare?qty_base=18&tax_basis=inclusive -> HTTP ${cmp.status} code=${cmp.json.code}`);
rec(`    item=${cd.item?.name} 比价单位=${cd.item?.compare_unit_code} qty=${cd.qty} on_date=${cd.on_date} 组数=${cd.groups.length} 缺失供应商=${cd.missing_suppliers?.length ?? 0}`);
for (const g of cd.groups) {
  rec(`    组[${g.pricing_nature}/${g.pricing_mode ?? 'null'}] comparable=${g.comparable} reason=${g.reason ?? 'null'} basis_dimension=${g.basis_dimension ?? 'null'} lowest=${g.lowest_base_unit_price} 最低价供应商类型=${JSON.stringify(g.lowest_supplier_types)}`);
  for (const r of g.rows) {
    rec(`      - ${r.supplier_name}(${r.supplier_type}) 单位=${r.unit_code} bq=${r.base_unit_qty} qty_priced=${r.qty_priced} 档价=${r.tier_unit_price} 归一=${r.base_unit_price} state=${r.compare_state} lowest=${r.is_lowest} excl=${r.exclusive_reason ?? '-'} 陈旧=${r.staleness_days}天`);
  }
}

// ── 3b 同一价：取价接口对同一 qty 的口径 ──────────────────────
const ownRow = cd.groups[0].rows.find((r) => r.supplier_name.includes('本公司'));
const look = await call('GET', `/price-lookup?item_id=${truss.id}&qty=18&pricing_nature=custom_made&tax_basis=inclusive&supplier_id=${ownRow.supplier_id}`);
const lk = look.json.data;
rec(`[3b] GET /price-lookup 同一 supplier 同一 qty=18 -> HTTP ${look.status} qty_priced=${lk.qty_priced} 归一=${lk.base_unit_price} 档价=${lk.resolved_from.tier_unit_price}`);
rec(`     >>> 与比价对比：base_unit_price ${ownRow.base_unit_price} vs ${lk.base_unit_price}；qty_priced ${ownRow.qty_priced} vs ${lk.qty_priced}`);

// ── 4 建单 → 加 2 行 → 自检 → 出单 ────────────────────────────
const created = await call('POST', '/quotes', {
  customer_name: '深圳前海云启科技有限公司',
  event_name: '2026 春季新品发布会',
  valid_until: day(10),
  event_date: day(20),
  project_type: 'product_launch',
});
const quote = created.json.data;
rec(`[4a] POST /quotes -> HTTP ${created.status} code=${created.json.code} quote_no=${quote.quote_no} status=${quote.status} tax_statement=${quote.tax_statement} valid_until=${quote.valid_until}`);

const a = await call('POST', `/quotes/${quote.id}/items`, {
  line_kind: 'material', qty: '18', cost_source: 'price_book',
  item_id: truss.id, price_id: ownRow.price_id, sale_unit_price: '260.00',
});
rec(`[4b] 行1 price_book -> HTTP ${a.status} name=${a.json.data.item.item_name_snapshot} 成本单价=${a.json.data.item.cost_unit_price} 对客=${a.json.data.item.sale_unit_price} 参考最低=${a.json.data.item.reference_lowest_price} price_missing=${a.json.data.item.price_missing} source=${a.json.data.item.cost_source}`);

const b = await call('POST', `/quotes/${quote.id}/items`, {
  line_kind: 'personnel', qty: '2', cost_source: 'manual',
  item_name_snapshot: '主持人（临时手填）', unit_snapshot: '人/天',
  cost_unit_price: '1200.00', sale_unit_price: '1800.00', remark: '客户指定人选，价格库暂无',
});
rec(`[4c] 行2 manual -> HTTP ${b.status} name=${b.json.data.item.item_name_snapshot} 成本=${b.json.data.item.cost_unit_price} price_missing=${b.json.data.item.price_missing}`);
rec(`     合计 total_price=${b.json.data.quote_totals.total_price} total_cost=${b.json.data.quote_totals.total_cost} total_profit=${b.json.data.quote_totals.total_profit} margin=${b.json.data.quote_totals.margin_rate}`);

const riskGet = await call('GET', `/quotes/${quote.id}/risk-check`);
const riskPost = await call('POST', `/quotes/${quote.id}/risk-check`);
const rd = riskPost.json.data;
rec(`[4d] risk-check GET=${riskGet.status} POST=${riskPost.status} blocked=${rd.blocked} blockers=${rd.blockers.length} warnings=${rd.warnings.map((w) => w.code).join(',')} warn_rate=${rd.warn_rate_used}(${rd.warn_rate_source})`);
for (const w of rd.warnings) rec(`      warning ${w.code}: ${w.title} — ${w.detail}`);

const issue = await call('POST', `/quotes/${quote.id}/issue`);
rec(`[4e] POST /quotes/{id}/issue -> HTTP ${issue.status} code=${issue.json.code} status=${issue.json.data.status} issued_at=${issue.json.data.issued_at} quote_no=${issue.json.data.quote_no}`);

// ── 5 权限：member 改金额 40301 / 新建价允许 ──────────────────
cookie = '';
const mlogin = await call('POST', '/auth/login', { login: 'xiaowang', password: PWD });
const memberCk = cookie;
rec(`[5a] member 登录 -> HTTP ${mlogin.status} role=${mlogin.json.data.role}`);

const mPatch = await call('PATCH', `/prices/${ownRow.price_id}`, { unit_price: '999.0000' }, memberCk);
rec(`[5b] member PATCH /prices/{id} {unit_price} -> HTTP ${mPatch.status} code=${mPatch.json.code} message=${mPatch.json.message}`);

const aPatch = await call('PATCH', `/prices/${ownRow.price_id}`, { unit_price: '999.0000' }, adminCk);
rec(`[5c] admin PATCH /prices/{id} {unit_price} -> HTTP ${aPatch.status} code=${aPatch.json.code} message=${aPatch.json.message}`);

const aNote = await call('PATCH', `/prices/${ownRow.price_id}`, { source_note: '联调：允许改的字段' }, adminCk);
rec(`[5d] admin PATCH /prices/{id} {source_note} -> HTTP ${aNote.status} code=${aNote.json.code} note=${aNote.json.data.source_note}`);

// member 新建价：换一个交易性质（六维键不同，不与现行价重叠）
const mCreate = await call('POST', '/prices', {
  item_id: truss.id, supplier_id: ownRow.supplier_id, unit_code: ownRow.unit_code,
  pricing_nature: 'rental_per_day', unit_price: '380.0000',
  effective_from: day(0), source_note: '联调：新增一条按天租赁价',
}, memberCk);
rec(`[5e] member POST /prices（新增，member 允许）-> HTTP ${mCreate.status} code=${mCreate.json.code} id=${String(mCreate.json.data.id).slice(0, 8)}… nature=${mCreate.json.data.pricing_nature} 单价=${mCreate.json.data.unit_price} state=${mCreate.json.data.effective_state}`);

// ── 6 区间重叠 40902 ──────────────────────────────────────────
const ov = await call('POST', '/prices', {
  item_id: truss.id, supplier_id: ownRow.supplier_id, unit_code: ownRow.unit_code,
  pricing_nature: 'rental_per_day', unit_price: '420.0000', effective_from: day(0),
}, memberCk);
rec(`[6] POST /prices 与上一条同日重叠 -> HTTP ${ov.status} code=${ov.json.code} message=${ov.json.message}`);
rec(`    顶层 proposed_close=${JSON.stringify(ov.json.proposed_close)}`);
rec(`    含 constraint/violation/23P01 ? ${/constraint|violation|23P01/i.test(ov.text) ? '是（不合格）' : '否（合格）'}`);

// ── 7 member 导出内部版 40302 ────────────────────────────────
const mi = await fetch(`${BASE}/quotes/${quote.id}/export.xlsx?view=internal`, { headers: { cookie: memberCk } });
rec(`[7] member 导出内部版 -> HTTP ${mi.status} ${(await mi.text()).slice(0, 90)}`);

// ── 8 两版导出的字节与文件名 ─────────────────────────────────
for (const view of ['customer', 'internal']) {
  const r = await fetch(`${BASE}/quotes/${quote.id}/export.xlsx?view=${view}`, { headers: { cookie: adminCk } });
  const buf = Buffer.from(await r.arrayBuffer());
  rec(`[8] export view=${view} -> HTTP ${r.status} bytes=${buf.length} disposition=${r.headers.get('content-disposition')}`);
}

// ── 9 台账统计（group_by=project_type） ──────────────────────
const sum = await call('GET', '/quotes/summary?group_by=project_type', undefined, adminCk);
const sd = sum.json.data;
rec(`[9] GET /quotes/summary?group_by=project_type -> HTTP ${sum.status} quote_count=${sd.quote_count} total=${sd.total_price} avg_margin=${sd.avg_margin_rate} by_status=${JSON.stringify(sd.by_status)}`);
for (const p of sd.by_project_type ?? []) rec(`      ${p.project_type ?? 'null'}: ${p.quote_count} 单 ${p.total_price} margin=${p.avg_margin_rate} warn=${p.warn_rate} below=${p.below_warn_count}`);
rec(`      top 客户=${sd.top_customers.map((c) => `${c.customer_name}/${c.total_price}`).join(' | ')}`);
