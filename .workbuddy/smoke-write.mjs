/** 写路径巡检：报价单全流程 + 基础资源 CRUD（自建自删，收尾清理）。 */
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
let cookie = '';
const rec = (s) => console.log(s);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function call(method, p, body, ck) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const use = ck !== undefined ? ck : cookie;
  if (use) headers.cookie = use;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const rc = sc.find((c) => c.startsWith('rc_session='));
  if (rc) { const q = rc.split(';')[0]; if (q.length > 11) cookie = q; }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const show = (tag, r, extra = '') =>
  rec(`${r.status >= 200 && r.status < 300 ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(3)} ${tag} code=${r.json?.code} ${extra}${r.json?.message && r.json.code !== 0 ? ' msg=' + String(r.json.message).slice(0, 70) : ''}`);

await call('POST', '/auth/login', { login: 'admin', password: PWD });

// ── 供应商 / 分类 / 账号 / 主体 的建-改-删 ───────────────────
const sup = await call('POST', '/suppliers', { name: '联调临时供应商', type: 'factory', contact_name: '张三', default_lead_time_days: 7 });
show('POST /suppliers', sup, `id=${sup.json?.data?.id?.slice(0, 8)}`);
const supPatch = await call('PATCH', `/suppliers/${sup.json.data.id}`, { note: '已联调' });
show('PATCH /suppliers/{id}', supPatch, `note=${supPatch.json?.data?.note}`);

const cat = await call('POST', '/categories', { domain: 'material', name: '联调临时分类', default_pricing_nature: 'custom_made' });
show('POST /categories', cat, `id=${cat.json?.data?.id?.slice(0, 8)}`);
const catPatch = await call('PATCH', `/categories/${cat.json.data.id}`, { name: '联调临时分类2' });
show('PATCH /categories/{id}', catPatch, `name=${catPatch.json?.data?.name}`);
const catBad = await call('PATCH', `/categories/${cat.json.data.id}`, { domain: 'personnel' });
show('PATCH /categories/{id} 跨域（应 42206）', catBad);

const usr = await call('POST', '/users', { login: 'liantiao_tmp', name: '联调临时账号', password: 'Tmp!2026youdee', role: 'member' });
show('POST /users', usr, `id=${usr.json?.data?.id?.slice(0, 8)}`);
const usrWeak = await call('POST', '/users', { login: 'weak_tmp', name: '弱密码', password: '123456', role: 'member' });
show('POST /users 弱密码（应 400）', usrWeak);
const usrSelf = await call('PATCH', `/users/${usr.json.data.id}`, { role: 'admin' });
show('PATCH /users/{id} 提权', usrSelf, `role=${usrSelf.json?.data?.role}`);

const item = await call('POST', '/items', {
  item_type: 'material', category_id: cat.json.data.id, name: '联调临时物料',
  base_unit_code: 'piece', compare_unit_code: 'piece', spec: '30cm',
});
show('POST /items', item, `id=${item.json?.data?.id?.slice(0, 8)}`);
const itemPatch = await call('PATCH', `/items/${item.json.data.id}`, { spec: '35cm', aliases: ['临时'] });
show('PATCH /items/{id}', itemPatch, `spec=${itemPatch.json?.data?.spec}`);

// 该主体建一条价，验证「有价后改基准单位 → 42204」
const priceForItem = await call('POST', '/prices', {
  item_id: item.json.data.id, supplier_id: sup.json.data.id, unit_code: 'piece',
  pricing_nature: 'purchase', unit_price: '12.5000', effective_from: day(0),
});
show('POST /prices（新主体）', priceForItem, `id=${priceForItem.json?.data?.id?.slice(0, 8)}`);
const unitChange = await call('PATCH', `/items/${item.json.data.id}`, { base_unit_code: 'set' });
show('PATCH /items/{id} 有价后改基准单位（应 42204）', unitChange);

// 附件上传（用一个最小 png 头）
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'tmp.png');
const up = await fetch(`${BASE}/uploads`, { method: 'POST', headers: { cookie }, body: fd });
const upJson = await up.json().catch(() => null);
rec(`${up.ok ? 'ok  ' : 'FAIL'} ${up.status} POST /uploads code=${upJson?.code} url=${upJson?.data?.url ?? '-'}`);
const att = await call('POST', `/prices/${priceForItem.json.data.id}/attachments`, { storage_key: upJson?.data?.storage_key, url: upJson?.data?.url, label: '比价截图' });
show('POST /prices/{id}/attachments', att, `id=${att.json?.data?.id?.slice(0, 8)}`);
const attDel = await call('DELETE', `/prices/${priceForItem.json.data.id}/attachments/${att.json?.data?.id}`);
show('DELETE /prices/{id}/attachments/{aid}', attDel);

// 图片 / 外链
const img = await call('POST', `/items/${item.json.data.id}/images`, { storage_key: upJson?.data?.storage_key, url: upJson?.data?.url, label: '主图' });
show('POST /items/{id}/images', img, `id=${img.json?.data?.id?.slice(0, 8)}`);
const link = await call('POST', `/items/${item.json.data.id}/links`, { label: '淘宝链接', url: 'https://item.taobao.com/x' });
show('POST /items/{id}/links', link, `id=${link.json?.data?.id?.slice(0, 8)}`);
const linkPatch = await call('PATCH', `/items/${item.json.data.id}/links/${link.json.data.id}`, { label: '淘宝旗舰店' });
show('PATCH /items/{id}/links/{lid}', linkPatch, `label=${linkPatch.json?.data?.label}`);
const linkDel = await call('DELETE', `/items/${item.json.data.id}/links/${link.json.data.id}`);
show('DELETE /items/{id}/links/{lid}', linkDel);

// ── 报价单写路径全流程 ─────────────────────────────────────
const q = await call('POST', '/quotes', {
  customer_name: '联调临时客户', event_name: '联调临时活动',
  valid_until: day(15), event_date: day(25), project_type: 'annual_meeting',
});
show('POST /quotes', q, `quote_no=${q.json?.data?.quote_no}`);
const qid = q.json.data.id;

const bulk = await call('POST', `/quotes/${qid}/items/bulk`, {
  items: [
    { line_kind: 'material', qty: '3', cost_source: 'manual', item_name_snapshot: '联调行 A', unit_snapshot: '件', cost_unit_price: '10.00', sale_unit_price: '20.00' },
    { line_kind: 'material', qty: '5', cost_source: 'manual', item_name_snapshot: '联调行 B', unit_snapshot: '件', cost_unit_price: '4.00', sale_unit_price: '9.00' },
  ],
});
show('POST /quotes/{id}/items/bulk', bulk, `行数=${bulk.json?.data?.items?.length} 合计=${bulk.json?.data?.quote_totals?.total_price}`);
const ids = bulk.json.data.items.map((x) => x.id);

const linePatch = await call('PATCH', `/quotes/${qid}/items/${ids[0]}`, { qty: '4', sale_unit_price: '22.00' });
show('PATCH /quotes/{id}/items/{iid}', linePatch, `qty=${linePatch.json?.data?.item?.qty} 合计=${linePatch.json?.data?.quote_totals?.total_price}`);

const reorder = await call('PATCH', `/quotes/${qid}/items/reorder`, { ordered_ids: [ids[1], ids[0]] });
show('PATCH /quotes/{id}/items/reorder', reorder, `首行=${reorder.json?.data?.items?.[0]?.item_name_snapshot ?? reorder.json?.data?.[0]?.item_name_snapshot}`);

const margin = await call('POST', `/quotes/${qid}/apply-target-margin`, { item_ids: [ids[0]] });
show('POST /quotes/{id}/apply-target-margin', margin, `合计=${margin.json?.data?.quote_totals?.total_price} margin=${margin.json?.data?.quote_totals?.margin_rate}`);

const recalc = await call('POST', `/quotes/${qid}/recalculate`);
show('POST /quotes/{id}/recalculate', recalc, `warnings=${JSON.stringify(recalc.json?.data?.warnings ?? [])}`);

const dry = await call('POST', `/quotes/${qid}/refresh-prices`, { dry_run: true });
show('POST /quotes/{id}/refresh-prices dry_run', dry, `changed=${dry.json?.data?.changed_count ?? dry.json?.data?.changes?.length}`);
const dryMissing = await call('POST', `/quotes/${qid}/refresh-prices`, {});
show('POST refresh-prices 不传 dry_run（应 400）', dryMissing);

const tp = await call('POST', `/quotes/${qid}/tax-basis/preview`, { tax_statement: 'exclusive' });
show('POST /quotes/{id}/tax-basis/preview', tp, `合计前=${tp.json?.data?.before?.total_price} 合计后=${tp.json?.data?.after?.total_price} 缺价行=${tp.json?.data?.will_be_missing?.length ?? 0}`);
const tApply = await call('PATCH', `/quotes/${qid}`, { tax_statement: 'exclusive' });
show('PATCH /quotes/{id} 切口径', tApply, `tax_statement=${tApply.json?.data?.tax_statement}`);
await call('PATCH', `/quotes/${qid}`, { tax_statement: 'inclusive' });
rec('    口径已切回 inclusive');

const del = await call('DELETE', `/quotes/${qid}/items/${ids[1]}`);
show('DELETE /quotes/{id}/items/{iid}', del, `合计=${del.json?.data?.quote_totals?.total_price}`);

const nv = await call('POST', `/quotes/${qid}/new-version`, { copy_items: true });
show('POST /quotes/{id}/new-version', nv, `新单 ${nv.json?.data?.quote_no} v=${nv.json?.data?.version} 行数=${nv.json?.data?.items?.length ?? '-'}`);
const newId = nv.json?.data?.id;

await call('POST', `/quotes/${newId}/issue`);
const vd = await call('POST', `/quotes/${newId}/void`, { reason: '联调收尾作废' });
show('POST /quotes/{id}/void', vd, `status=${vd.json?.data?.status}`);

// ── 清理（自建数据自己删） ─────────────────────────────────
await call('DELETE', `/quotes/${newId}`);
await call('DELETE', `/quotes/${qid}`);
const itemDeact = await call('DELETE', `/items/${item.json.data.id}`);
show('DELETE /items/{id}（有价，应转停用）', itemDeact, `is_active=${itemDeact.json?.data?.is_active}`);
const catDelBad = await call('DELETE', `/categories/${cat.json.data.id}`);
show('DELETE /categories/{id}（有主体，应为 409/422）', catDelBad);
const supDelBad = await call('DELETE', `/suppliers/${sup.json.data.id}`);
show('DELETE /suppliers/{id}（有价格，应 40904）', supDelBad);
const usrDeact = await call('DELETE', `/users/${usr.json.data.id}`);
show('DELETE /users/{id}', usrDeact, `is_active=${usrDeact.json?.data?.is_active}`);
