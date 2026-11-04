/**
 * 第二轮：取证 + 补验 close_previous / 42205 / 42207 / 通知。
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

const adminLogin = await call('POST', '/auth/login', { login: 'admin', password: PWD });
const adminCk = cookie;
rec(`admin 登录 HTTP ${adminLogin.status} data.login=${adminLogin.json.data?.login} data.role=${adminLogin.json.data?.role} isActive=${adminLogin.json.data?.isActive}`);

const list = await call('GET', '/items?item_type=material&limit=100');
const truss = (list.json.data.items ?? []).find((i) => i.name.includes('桁架背景板'));
rec(`桁架背景板 id=${truss.id} base_unit=${truss.base_unit_code} compare_unit=${truss.compare_unit_code}`);

// ── A. 同一 base_unit_qty：比价 vs 取价 的折算是否一致 ─────────
const cmp = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=inclusive`);
rec(`\n[A] compare 组数=${cmp.json.data.groups.length} qty=${cmp.json.data.qty} tier_breakpoints=${JSON.stringify(cmp.json.data.tier_breakpoints)}`);
const ownRow = cmp.json.data.groups[0].rows.find((r) => r.supplier_name.includes('本公司'));
const cmpRow = cmp.json.data.groups[0].rows.find((r) => r.supplier_name.includes('本公司'));
rec(`    compare 行: supplier=${cmpRow.supplier_name} base_unit_qty=${cmpRow.base_unit_qty} qty_priced=${cmpRow.qty_priced} tier_unit_price=${cmpRow.tier_unit_price} base_unit_price=${cmpRow.base_unit_price} state=${cmpRow.compare_state}`);

const look = await call('GET', `/price-lookup?item_id=${truss.id}&qty=18&pricing_nature=custom_made&tax_basis=inclusive&supplier_id=${cmpRow.supplier_id}`);
const lk = look.json.data;
rec(`    lookup  行: HTTP ${look.status} qty_priced=${lk?.qty_priced} tier_unit_price=${lk?.resolved_from?.tier_unit_price} base_unit_price=${lk?.base_unit_price} 参考价=${lk?.resolved_from?.unit_code}/${lk?.resolved_from?.base_unit_qty}`);
rec(`    >>> 同一 supplier 同一 qty：compare base_unit_price=${cmpRow.base_unit_price} vs lookup base_unit_price=${lk?.base_unit_price} ${cmpRow.base_unit_price === lk?.base_unit_price ? '（一致）' : '（不一致 = 静默偏差）'}；qty_priced ${cmpRow.qty_priced} vs ${lk?.qty_priced}`);

// ── B. price-lookup 未命中 42205（另一口径有价） ─────────────
const miss = await call('GET', `/price-lookup?item_id=${truss.id}&qty=18&pricing_nature=custom_made&tax_basis=exclusive&supplier_id=${cmpRow.supplier_id}`);
rec(`\n[B] lookup 不含税口径（该公司只报含税）-> HTTP ${miss.status} code=${miss.json.code} message=${miss.json.message}`);
rec(`    detail: other_basis_exists=${miss.json.detail?.other_basis_exists} other_price=${miss.json.detail?.other_basis_price} other_incl=${miss.json.detail?.other_basis_tax_included}`);

// ── C. member 走「新增并关闭旧价」标准调价 ────────────────────
cookie = '';
await call('POST', '/auth/login', { login: 'xiaowang', password: PWD });
const memberCk = cookie;
rec(`\n[C] member 登录 -> ${memberCk ? 'ok' : 'fail'}`);

const detail = await call('GET', `/prices/${cmpRow.price_id}`, undefined, memberCk);
const d = detail.json.data;
rec(`    GET /prices/{id} -> HTTP ${detail.status} unit_code=${d.unit_code} nature=${d.pricing_nature} tax_included=${d.tax_included} base_unit_qty=${d.base_unit_qty} effective_from=${d.effective_from} effective_to=${d.effective_to} state=${d.effective_state}`);

const adj = await call('POST', '/prices', {
  item_id: truss.id,
  supplier_id: d.supplier_id,
  unit_code: d.unit_code,
  pricing_nature: d.pricing_nature,
  tax_included: d.tax_included,
  base_unit_qty: d.base_unit_qty,
  unit_price: '1500.0000',
  effective_from: day(1),
  close_previous: true,
  source_note: '联调：桁架涨价至 1500/套',
}, memberCk);
rec(`    member POST /prices close_previous=true -> HTTP ${adj.status} code=${adj.json.code} 新price=${String(adj.json.data?.id ?? '').slice(0, 8)}… previous_closed=${String(adj.json.data?.previous_closed_id ?? '').slice(0, 8)}… 单价=${adj.json.data?.unit_price}`);

const old = await call('GET', `/prices/${d.id}`, undefined, memberCk);
rec(`    旧价复查 -> status=${old.json.data?.status} effective_to=${old.json.data?.effective_to} state=${old.json.data?.effective_state}（应 = ${day(0)} 前后一天）`);

// ── D. 42207：close_previous 定位不到现行价 ──────────────────
const noCover = await call('POST', '/prices', {
  item_id: truss.id,
  supplier_id: d.supplier_id,
  unit_code: d.unit_code,
  pricing_nature: d.pricing_nature,
  tax_included: d.tax_included,
  base_unit_qty: d.base_unit_qty,
  unit_price: '100.0000',
  effective_from: '2020-01-01',
  close_previous: true,
}, memberCk);
rec(`\n[D] POST /prices close_previous=true 但当日无现行价 -> HTTP ${noCover.status} code=${noCover.json.code} message=${noCover.json.message}`);

// ── E. 比价不可比行必须保留（换一个单位不可折算的视角） ──────
const cmp2 = await call('GET', `/items/${truss.id}/compare?qty_base=18`, undefined, memberCk);
const g2 = cmp2.json.data.groups[0];
rec(`\n[E] compare 不传 tax_basis（默认取 app_settings）-> tax=${g2.tax_basis} comparable=${g2.comparable} reason=${g2.reason} rows=${g2.rows.length} 不可比行=${g2.rows.filter((r) => r.compare_state === 'not_comparable').length} 带原因的行=${g2.rows.filter((r) => r.exclusive_reason).map((r) => r.supplier_name + ':' + r.exclusive_reason).join(',') || '无'}`);

// ── F. 出单后的通知与台账 ───────────────────────────────────
const quotes = await call('GET', '/quotes?limit=5', undefined, adminCk);
rec(`\n[F] GET /quotes -> HTTP ${quotes.status} total=${quotes.json.data?.total} 首条=${quotes.json.data?.items?.[0]?.quote_no}/${quotes.json.data?.items?.[0]?.status}`);
const unread = await call('GET', '/notifications/unread-count', undefined, adminCk);
rec(`    GET /notifications/unread-count -> HTTP ${unread.status} ${JSON.stringify(unread.json.data)}`);
const notes = await call('GET', '/notifications?limit=3', undefined, adminCk);
rec(`    GET /notifications -> HTTP ${notes.status} total=${notes.json.data?.total} 首条=${notes.json.data?.items?.[0]?.title ?? '-'} kind=${notes.json.data?.items?.[0]?.kind ?? '-'}`);
const dash = await call('GET', '/dashboard/summary', undefined, adminCk);
rec(`    GET /dashboard/summary -> HTTP ${dash.status} 本月单数=${dash.json.data?.month_quote_count} 本月金额=${dash.json.data?.month_quote_total} 陈旧价=${dash.json.data?.stale_price_count} 手填比=${dash.json.data?.manual_cost_line_ratio}`);
const sum = await call('GET', '/quotes/summary', undefined, adminCk);
rec(`    GET /quotes/summary -> HTTP ${sum.status} by_status=${JSON.stringify((sum.json.data?.by_status ?? []).map((s) => s.status + ':' + s.count))} top客户=${sum.json.data?.top_customers?.[0]?.customer_name ?? '-'}`);

// ── G. 内部版导出（含成本列）应 200，且与客户版不同 ──────────
const qid = quotes.json.data.items[0].id;
const ci = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=internal`, { headers: { cookie: adminCk } });
const cc = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=customer`, { headers: { cookie: adminCk } });
const bi = Buffer.from(await ci.arrayBuffer());
const bc = Buffer.from(await cc.arrayBuffer());
rec(`\n[G] internal 导出 HTTP ${ci.status} bytes=${bi.length} | customer 导出 HTTP ${cc.status} bytes=${bc.length} 两者不同=${bi.length !== bc.length}`);

// ── H. 权限：member 导出内部版必须 40302 ────────────────────
const mi = await fetch(`${BASE}/quotes/${qid}/export.xlsx?view=internal`, { headers: { cookie: memberCk } });
const miJson = await mi.text();
rec(`[H] member 导出内部版 -> HTTP ${mi.status} body=${miJson.slice(0, 120)}`);

// ── I. 归档价格（admin 允许） ───────────────────────────────
const arch = await call('POST', `/prices/${d.id}/archive`, {}, adminCk);
rec(`\n[I] admin POST /prices/{id}/archive（旧价已被替代）-> HTTP ${arch.status} code=${arch.json.code} message=${arch.json.message ?? ''}`);
