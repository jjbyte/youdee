/**
 * 部署后自检。部署完在服务器上跑一次：node deploy/verify.mjs
 *
 * 为什么要有这个文件：这套系统最危险的缺陷都不报错，只是数字或状态不对
 * （金额标度错 100 倍、含税口径不同却被当成可比、成员能改别人的价）。
 * 光看"网站能打开"完全发现不了。所以这里按业务链路走一遍，每步都比对具体数值。
 *
 * 会写入数据：建 1 张报价单并发出（状态 issued，删除接口只允许 draft）。
 * 跑完请到「报价单」里把客户名为「自检样例」的那张作废或留着，不要当成真实业务数据。
 */
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN = { login: process.env.ADMIN_LOGIN || 'admin', password: process.env.ADMIN_PASSWORD || 'youdee2026' };
const MEMBER = { login: process.env.MEMBER_LOGIN || 'xiaowang', password: process.env.MEMBER_PASSWORD || 'youdee2026' };

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const jar = {};
async function call(method, path, { body, as } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as && jar[as]) headers.Cookie = jar[as];
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookie.find((c) => c.startsWith('rc_session='));
  if (as && sessionCookie) jar[as] = sessionCookie.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { code: -1, message: `非 JSON 响应（${res.status}）：${text.slice(0, 120)}` };
  }
  return { status: res.status, json, raw: text, headers: res.headers };
}

async function main() {
  console.log(`自检目标：${BASE}\n`);

  // 1. 进程与数据库
  const health = await call('GET', '/health');
  record('健康检查', health.json?.data?.db === 'ok', `db=${health.json?.data?.db ?? '无响应'}`);

  // 2. 登录
  const login = await call('POST', '/auth/login', { body: ADMIN, as: 'admin' });
  record('管理员登录', login.json?.code === 0 && !!jar.admin, `${login.json?.data?.name ?? login.json?.message ?? ''}`);

  // 3. 主体库有数据（种子是否灌进去了）
  const items = await call('GET', '/items?item_type=material&limit=100', { as: 'admin' });
  const total = items.json?.data?.total ?? 0;
  record('物料库已初始化', total >= 15, `material 共 ${total} 条`);

  const truss = (items.json?.data?.items ?? []).find((i) => String(i.name).includes('桁架背景板'));
  record('找到示例主体「桁架背景板」', !!truss, truss ? truss.id : '未找到，后续比价与取价检查会跳过');
  if (!truss) return;

  // 4. 比价：所有价必须都在（含不可比的），最低价必须标出来
  const cmp = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=inclusive`, { as: 'admin' });
  const group = (cmp.json?.data?.groups ?? [])[0];
  const rows = group?.rows ?? [];
  const lowestRow = rows.find((r) => r.is_lowest);
  record('比价命中 1 组', !!group, group ? `${group.pricing_nature} / ${group.unit_mode ?? '非时间'} / 可比 ${group.comparable_count}/${group.total_count}` : '无分组');

  // 铁律：不可比的行不参与排序，但**绝不隐藏** —— 过滤掉"这家有货、只是单位或口径没法比"，
  // 用户永远不会想起来补折算系数，也永远以为这家没报价。
  //
  // 这里曾经写的是 `rows.length >= 4`（期待种子有 4 家），种子只有 3 家就报失败，
  // 把正确行为判成缺陷。断言不能依赖"现在有几家供应商"，只断言恒等关系：
  //   ① 返回行数 == total_count                —— 少一行就说明被过滤了
  //   ② 不可比行数 == total_count - 可比数      —— 组内计数自洽
  //   ③ 每个不可比行都带 warnings              —— 灰化卡片上得有话说
  //   ④ 换一次税口径，家数不变                  —— 换口径只改"谁最低"，不改"有谁"
  const cmpOther = await call('GET', `/items/${truss.id}/compare?qty_base=18&tax_basis=exclusive`, { as: 'admin' });
  const otherRows = (cmpOther.json?.data?.groups ?? [])[0]?.rows ?? [];
  const incomparable = rows.filter((r) => r.exclusive_reason);
  const groupTotal = group?.total_count ?? 0;
  const comparableCount = group?.comparable_count ?? 0;
  const allKept =
    rows.length === groupTotal &&
    incomparable.length === groupTotal - comparableCount &&
    incomparable.every((r) => Array.isArray(r.warnings) && r.warnings.length > 0) &&
    otherRows.length === groupTotal;
  record(
    '不可比的行没有被隐藏',
    allKept,
    `共 ${rows.length} 行 = 可比 ${comparableCount} + 不可比 ${incomparable.length}` +
      `（${incomparable.map((r) => r.exclusive_reason).join('、') || '无'}）；换口径后仍 ${otherRows.length} 行`,
  );
  record(
    '标出了最低价',
    !!lowestRow,
    lowestRow ? `${lowestRow.supplier_name} 归一价 ${lowestRow.base_unit_price}` : '没有任何行被标为最低',
  );

  // 5. 不变式：同一个价在比价接口与取价接口必须是同一个数
  const lookup = await call(
    'GET',
    `/price-lookup?item_id=${truss.id}&qty=18&pricing_nature=custom_made&tax_basis=inclusive&on_date=${new Date().toISOString().slice(0, 10)}`,
    { as: 'admin' },
  );
  const lookupPrice = lookup.json?.data?.base_unit_price;
  const same = lowestRow && lookupPrice && String(lowestRow.base_unit_price) === String(lookupPrice);
  record('比价价 = 取价价（同一价同一个数）', same, `比价 ${lowestRow?.base_unit_price ?? '-'} / 取价 ${lookupPrice ?? lookup.json?.message ?? '-'}`);

  // 6. 建单 + 加两行
  const today = new Date();
  const eventDate = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const validUntil = new Date(today.getTime() + 15 * 86400_000).toISOString().slice(0, 10);
  const quote = await call('POST', '/quotes', {
    as: 'admin',
    body: {
      customer_name: '自检样例',
      event_name: '部署自检，可作废',
      event_date: eventDate,
      valid_until: validUntil,
      project_type: 'annual_meeting',
      tax_statement: 'inclusive',
    },
  });
  const qid = quote.json?.data?.id;
  record('新建报价单', quote.json?.code === 0 && !!qid, quote.json?.data?.quote_no ?? quote.json?.message ?? '');
  if (!qid) return;

  const line1 = await call('POST', `/quotes/${qid}/items`, {
    as: 'admin',
    body: {
      line_kind: 'material',
      item_id: truss.id,
      item_name_snapshot: truss.name,
      unit_snapshot: '套',
      qty: '1',
      cost_source: 'price_book',
      sale_unit_price: '2600',
      pricing_nature: 'custom_made',
    },
  });
  record('加行：从价格库取成本', line1.json?.code === 0, line1.json?.message ?? '');

  const line2 = await call('POST', `/quotes/${qid}/items`, {
    as: 'admin',
    body: {
      line_kind: 'custom',
      item_name_snapshot: '临时加急喷绘',
      unit_snapshot: '张',
      qty: '10',
      cost_source: 'manual',
      cost_unit_price: '60',
      sale_unit_price: '120',
    },
  });
  record('加行：手填成本', line2.json?.code === 0, line2.json?.message ?? '');

  // 7. 自检：手填成本只应是 warning，绝不能拦住出单
  const risk = await call('GET', `/quotes/${qid}/risk-check`, { as: 'admin' });
  const rd = risk.json?.data ?? {};
  const codes = (rd.warnings ?? []).map((w) => w.code);
  record('自检：手填成本给出提醒', codes.includes('R2_MANUAL_COST'), codes.join(',') || '无提醒');
  record('自检：不因警告而拦截出单', rd.blocked === false, `blocked=${rd.blocked} blockers=${rd.blocker_count ?? '?'}`);

  // 8. 出单
  const issue = await call('POST', `/quotes/${qid}/issue`, { as: 'admin', body: {} });
  record('出单', issue.json?.code === 0, `${issue.json?.data?.status ?? issue.json?.message ?? ''} / 单号 ${quote.json?.data?.quote_no ?? ''}`);

  // 9. 导出：客户版必须是物理不含成本的另一个文件
  const exp = await fetch(`${BASE}/api/v1/quotes/${qid}/export.xlsx?view=customer`, {
    headers: { Cookie: jar.admin ?? '' },
  });
  const buf = Buffer.from(await exp.arrayBuffer());
  record('导出客户版', exp.status === 200 && buf.length > 2000, `${buf.length} 字节 / ${exp.headers.get('content-type') ?? '无类型'}`);

  const internalExp = await fetch(`${BASE}/api/v1/quotes/${qid}/export.xlsx?view=internal`, { headers: { Cookie: jar.admin ?? '' } });
  record('管理员可导出内部版', internalExp.status === 200, `${internalExp.status}`);

  // 10. 权限：成员改旧价必须被挡
  const mlogin = await call('POST', '/auth/login', { body: MEMBER, as: 'member' });
  record('成员登录', mlogin.json?.code === 0, mlogin.json?.data?.name ?? mlogin.json?.message ?? '');
  const priceList = await call('GET', `/prices?item_id=${truss.id}&limit=1`, { as: 'admin' });
  const priceId = priceList.json?.data?.items?.[0]?.id;
  if (priceId) {
    const patch = await call('PATCH', `/prices/${priceId}`, { as: 'member', body: { unit_price: '1500' } });
    record('成员改旧价被拒绝（40301）', patch.json?.code === 40301, `${patch.json?.code} ${patch.json?.message ?? ''}`);
  } else {
    record('成员改旧价被拒绝（40301）', false, '取不到价格 id，跳过');
  }

  // 11. 区间重叠：必须是人话，且响应里不许漏出数据库约束名
  const supId = priceList.json?.data?.items?.[0]?.supplier_id;
  if (supId) {
    const overlap = await call('POST', '/prices', {
      as: 'admin',
      body: {
        item_id: truss.id,
        supplier_id: supId,
        unit_code: 'set',
        base_unit_qty: '0.055556',
        unit_price: '3300',
        tax_included: true,
        pricing_nature: 'custom_made',
        effective_from: new Date(today.getTime() - 90 * 86400_000).toISOString().slice(0, 10),
        close_previous: false,
      },
    });
    record('区间重叠被拦（40902）', overlap.json?.code === 40902, `${overlap.json?.code} ${overlap.json?.message ?? ''}`);
    const leaked = ['23P01', 'constraint', 'violation', 'prisma'].filter((k) => overlap.raw.toLowerCase().includes(k.toLowerCase()));
    record('错误响应不含数据库术语', leaked.length === 0, leaked.length ? `泄漏：${leaked.join(', ')}` : '干净');
  }

  console.log(`\n本次自检产生了 1 张已发出的报价单：${quote.json?.data?.quote_no ?? ''}（客户名「自检样例」），请按需作废。`);
}

const fail = (e) => {
  console.error('\n自检中断：', e instanceof Error ? e.message : e);
  process.exit(1);
};

main()
  .then(() => {
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - bad.length}，失败 ${bad.length}`);
    if (bad.length) {
      console.log('失败项：');
      for (const b of bad) console.log(`  - ${b.name}（${b.detail ?? '无细节'}）`);
      process.exit(1);
    }
  })
  .catch(fail);
