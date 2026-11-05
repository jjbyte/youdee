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

  // 2b. Cookie 能不能真的落到浏览器里。
  // 这一项是在公网部署上吃了亏才加的：登录接口返回 200、账号密码全对，
  // 但 Set-Cookie 带 Secure 而页面是 http://IP:3000 —— 浏览器会**静默丢弃**它，
  // 下一次请求就没身份，前端显示「登录已过期，请重新登录」。
  // 本脚本自己拿 Cookie，天生绕过浏览器策略，所以这里必须直接读 Set-Cookie 头，
  // 否则这类缺陷永远测不出来（之前 20 项全过、浏览器却登不进去，就是这么来的）。
  const setCookies = login.headers.getSetCookie?.() ?? [];
  const sessionHeader = setCookies.find((c) => c.startsWith('rc_session=')) ?? '';
  const httpsTarget = BASE.startsWith('https://');
  const cookieHasSecure = /;\s*secure/i.test(sessionHeader);
  record(
    '会话 Cookie 能落到浏览器',
    !!sessionHeader && (httpsTarget || !cookieHasSecure),
    !sessionHeader
      ? '没有 Set-Cookie: rc_session'
      : httpsTarget
        ? 'HTTPS 目标，Secure 已置'
        : cookieHasSecure
          ? 'Set-Cookie 带 Secure 但目标是 http，浏览器会丢弃它 —— 设 COOKIE_SECURE=0，或改用 HTTPS'
          : 'http 目标且未带 Secure，浏览器可写入',
  );

  // 2c. 页面路由在不在。「嘉宾价」曾经指向 /staff?category=guest，
  //     同一 pathname 换 query 不会重挂载组件，点了等于没反应；后来改成独立路由 /guests。
  //     0.1.11 侧栏不再挂这个入口（人员库自己就能按分类筛），但路由必须还在——
  //     老书签、别人发过的地址打开不能 404。
  //     静态页在 SSR 时只吐骨架，所以只断言 HTTP 200，不在 HTML 里找文案。
  const guestPage = await fetch(`${BASE}/guests`, { headers: { Cookie: jar.admin ?? '' } });
  record('「嘉宾价」老链接仍可打开', guestPage.status === 200, `HTTP ${guestPage.status}`);

  // 2d. 权限编辑：三个用户接口 0.1.0 就在，但界面上只有一张只读表，等于管理员开不了权限。
  //     这里建一个临时账号走一遍「新建 → 升管理员 → 降回成员 → 停用」，全程可逆。
  //     留一条 is_active=false 的「自检临时账号」在库里，属正常现象（停用是软删，台账要留署名）。
  const adminId = login.json?.data?.id;
  const tmpLogin = `selfcheck_${Date.now().toString(36)}`;
  const created = await call('POST', '/users', {
    as: 'admin',
    body: { login: tmpLogin, name: '自检临时账号', password: 'selfcheck-2026', role: 'member' },
  });
  const tmpId = created.json?.data?.id;
  record('管理员能新建账号', created.json?.code === 0 && !!tmpId, `${created.json?.code} ${created.json?.message ?? tmpLogin}`);
  if (tmpId) {
    const promote = await call('PATCH', `/users/${tmpId}`, { as: 'admin', body: { role: 'admin' } });
    record(
      '管理员能把成员提成管理员',
      promote.json?.code === 0 && promote.json?.data?.role === 'admin',
      `${promote.json?.code} role=${promote.json?.data?.role ?? promote.json?.message ?? ''}`,
    );
    const demote = await call('PATCH', `/users/${tmpId}`, { as: 'admin', body: { role: 'member' } });
    record(
      '管理员能把管理员降回成员',
      demote.json?.code === 0 && demote.json?.data?.role === 'member',
      `${demote.json?.code} role=${demote.json?.data?.role ?? demote.json?.message ?? ''}`,
    );
    const selfDemote = await call('PATCH', `/users/${adminId}`, { as: 'admin', body: { role: 'member' } });
    record(
      '不能把自己降权（40904）',
      selfDemote.json?.code === 40904,
      `${selfDemote.json?.code} ${selfDemote.json?.message ?? ''}`,
    );
    const bye = await call('DELETE', `/users/${tmpId}`, { as: 'admin' });
    record(
      '停用临时账号',
      bye.json?.code === 0 && bye.json?.data?.is_active === false,
      `${bye.json?.code} ${bye.json?.message ?? ''}`,
    );
  } else {
    record('管理员能把成员提成管理员', false, '账号没建出来，后续权限检查跳过');
    record('管理员能把管理员降回成员', false, '同上');
    record('不能把自己降权（40904）', false, '同上');
    record('停用临时账号', false, '同上');
  }

  // 3. 主体库有数据（种子是否灌进去了）
  const items = await call('GET', '/items?item_type=material&limit=100', { as: 'admin' });
  const total = items.json?.data?.total ?? 0;
  record('物料库已初始化', total >= 15, `material 共 ${total} 条`);

  const truss = (items.json?.data?.items ?? []).find((i) => String(i.name).includes('桁架背景板'));
  record('找到示例主体「桁架背景板」', !!truss, truss ? truss.id : '未找到，后续比价与取价检查会跳过');
  if (!truss) return;

  // 3b. 档案写权限：管理员能改。
  //     真实反馈过"admin 登录后只能看不能改"，根因是前端压根没有编辑入口（不是权限）。
  //     这里从接口层把权限钉住：以后哪怕前端再退化成只读，这一项仍能证明后端是通的。
  const selfPatch = await call('PATCH', `/items/${truss.id}`, {
    as: 'admin',
    body: { name: truss.name, spec: truss.spec ?? null },
  });
  record(
    '管理员能改档案',
    selfPatch.json?.code === 0 && selfPatch.json?.data?.id === truss.id,
    selfPatch.json?.code === 0
      ? `已写回：${selfPatch.json?.data?.name ?? ''}`
      : `${selfPatch.json?.code} ${selfPatch.json?.message ?? ''}`,
  );

  // 3c. 供应商档案：同一个坑换了个页面。
  //     「admin 只能看不能改」第二次出现是在供应商页——PATCH /suppliers/:id 一直是通的，
  //     但界面只给了「删除供应商」，没有编辑入口。这里从接口层钉住能力，
  //     以后再退化成只读，这一项会先报警。
  const supList = await call('GET', '/suppliers?limit=1', { as: 'admin' });
  const firstSupplier = supList.json?.data?.items?.[0];
  if (firstSupplier) {
    const supPatch = await call('PATCH', `/suppliers/${firstSupplier.id}`, {
      as: 'admin',
      body: {
        name: firstSupplier.name,
        contact_name: firstSupplier.contact_name ?? null,
        default_lead_time_days: firstSupplier.default_lead_time_days ?? null,
      },
    });
    record(
      '管理员能改供应商档案',
      supPatch.json?.code === 0 && supPatch.json?.data?.id === firstSupplier.id,
      supPatch.json?.code === 0
        ? `已写回：${supPatch.json?.data?.name ?? ''}`
        : `${supPatch.json?.code} ${supPatch.json?.message ?? ''}`,
    );

    // 列表的「报价数」列必须和详情一致。
    // 这条是为一个"不报错的错数"加的：列表 SQL 只做了 SELECT *，没带统计，
    // 前端又写 `priceCount ?? 0` 兜底 —— 结果每一家都显示 0，看着像"这家没报过价"。
    const supDetail = await call('GET', `/suppliers/${firstSupplier.id}`, { as: 'admin' });
    const listCount = firstSupplier.price_count;
    const detailCount = supDetail.json?.data?.price_count;
    record(
      '供应商列表的报价数 = 详情报价数',
      typeof listCount === 'number' && listCount === detailCount,
      `列表 ${listCount ?? '缺字段'} / 详情 ${detailCount ?? '-'}`,
    );
  } else {
    record('管理员能改供应商档案', false, '供应商表是空的，连一条都没读到');
  }

  // 3d. 供应商开票信息（v1.13）：五项可选字段。
  //     为什么建一个临时供应商而不是拿第一家的来试：这五项是真数据，
  //     "写进去再清空"会在生产上把人家填好的税号抹掉——自检脚本绝不能有这种手。
  const tmpSup = await call('POST', '/suppliers', {
    as: 'admin',
    body: { name: `自检临时供应商${String(Date.now()).slice(-6)}`, type: 'factory' },
  });
  const tmpSupId = tmpSup.json?.data?.id;
  if (tmpSupId) {
    record(
      '新建供应商：五项开票信息全空也能建（可选字段不是必填字段）',
      tmpSup.json?.code === 0 &&
        tmpSup.json?.data?.tax_no === null &&
        tmpSup.json?.data?.bank_account === null,
      `tax_no=${tmpSup.json?.data?.tax_no} / bank_account=${tmpSup.json?.data?.bank_account}`,
    );

    const invPatch = await call('PATCH', `/suppliers/${tmpSupId}`, {
      as: 'admin',
      body: {
        // 故意送脏数据：小写、全角、空格、横杠 —— 入口处该洗干净再入库
        tax_no: '91310114ma1gx-8q23k',
        company_address: '上海市嘉定区安亭镇墨玉路 28 号 2 幢',
        company_phone: '021-5998 6677',
        bank_name: '中国工商银行上海安亭支行',
        bank_account: '1001 2004 0900 6789 123',
      },
    });
    const d = invPatch.json?.data ?? {};
    record(
      '开票信息入库前被规范化（税号转大写去横杠、账号去空格）',
      d.tax_no === '91310114MA1GX8Q23K' && d.bank_account === '1001200409006789123',
      `tax_no=${d.tax_no} / bank_account=${d.bank_account}`,
    );

    const reread = await call('GET', `/suppliers/${tmpSupId}`, { as: 'admin' });
    record(
      '开票信息读回来一致（详情页显示的就是库里那五个数）',
      reread.json?.data?.tax_no === '91310114MA1GX8Q23K' &&
        reread.json?.data?.bank_name === '中国工商银行上海安亭支行' &&
        reread.json?.data?.company_phone === '021-5998 6677',
      `${reread.json?.data?.company_phone} / ${reread.json?.data?.bank_name}`,
    );

    const badTax = await call('PATCH', `/suppliers/${tmpSupId}`, { as: 'admin', body: { tax_no: '1234' } });
    record(
      '税号格式不对时明确拒绝（40001 + 指出是哪一格）',
      badTax.json?.code === 40001 && JSON.stringify(badTax.json ?? {}).includes('tax_no'),
      `${badTax.json?.code} ${badTax.json?.message ?? ''}`,
    );

    // 只清能清的那一格，其余字段不动（三态：不提交 ≠ 清空）
    const clearOne = await call('PATCH', `/suppliers/${tmpSupId}`, { as: 'admin', body: { tax_no: null } });
    record(
      '只清一格不影响其他四格（不提交的字段不被清空）',
      clearOne.json?.data?.tax_no === null && clearOne.json?.data?.bank_name === '中国工商银行上海安亭支行',
      `tax_no=${clearOne.json?.data?.tax_no} / bank_name=${clearOne.json?.data?.bank_name}`,
    );

    await call('DELETE', `/suppliers/${tmpSupId}`, { as: 'admin' });
  } else {
    record('新建供应商：五项开票信息全空也能建（可选字段不是必填字段）', false, tmpSup.json?.message ?? '');
  }

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

  // 5b. 「用哪家」：取价接口带 supplier_id 时，必须**换成那一家的价**。
  //     价格库默认取"同性质同口径里最便宜"的那家；但便宜那家可能做不出来、交不了期、
  //     或者上次惹过客户——这是商务判断。界面原来没有传 supplier_id 的地方，
  //     只能攒进去再逐行点成本格换，等于勾完还要回头挨个改一遍。
  const sameBasisRows = rows.filter((r) => r.tax_included === true);
  const notLowest = sameBasisRows.find((r) => r.supplier_id !== lowestRow?.supplier_id);
  if (notLowest) {
    const picked = await call(
      'GET',
      `/price-lookup?item_id=${truss.id}&qty=18&pricing_nature=custom_made&tax_basis=inclusive`
        + `&supplier_id=${notLowest.supplier_id}&on_date=${new Date().toISOString().slice(0, 10)}`,
      { as: 'admin' },
    );
    const gotSupplier = picked.json?.data?.resolved_from?.supplier_id;
    const gotPrice = String(picked.json?.data?.base_unit_price ?? '');
    record(
      '攒单「用哪家」：指定供应商后取到的是这一家（不是默认的最低价那家）',
      gotSupplier === notLowest.supplier_id && gotPrice === String(notLowest.base_unit_price),
      `${notLowest.supplier_name} 应 ${notLowest.base_unit_price}，实得 ${gotPrice || picked.json?.message || '-'}`
        + (gotSupplier === notLowest.supplier_id ? '' : `（取到的是 ${gotSupplier}）`),
    );
  } else {
    record('攒单「用哪家」：指定供应商后取到的是这一家（不是默认的最低价那家）', false, '含税口径下只有一家，没法换');
  }

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

  // 6a. 项目类型 → 默认毛利率（v1.12）。
  //     客户原话"选择不同的类型，报价单的毛利率没有同步改变"。查下来不是联动写错了，
  //     是压根没有这个字段——类型此前只决定预警线的颜色。
  //     这里从接口层钉住"选了类型就该带出一个数"，以后再退化成只变颜色，这一项先报警。
  const qSettings = await call('GET', '/settings/quote', { as: 'admin' });
  const typeMargin = new Map(
    (qSettings.json?.data?.margin_thresholds ?? []).map((t) => [t.project_type, t.default_margin_rate]),
  );
  const annualMargin = Number(typeMargin.get('annual_meeting'));
  record(
    '建单：选了项目类型就带出该类默认毛利率（不是只变颜色）',
    Number.isFinite(annualMargin) &&
      annualMargin > 0 &&
      Number(quote.json?.data?.target_margin_rate) === annualMargin,
    `target_margin_rate=${quote.json?.data?.target_margin_rate} / 该类型默认=${typeMargin.get('annual_meeting')}`,
  );

  const launchMargin = Number(typeMargin.get('product_launch'));
  const switched = await call('PATCH', `/quotes/${qid}`, { as: 'admin', body: { project_type: 'product_launch' } });
  record(
    '换类型：毛利率跟着换成新类型的默认值',
    Number(switched.json?.data?.target_margin_rate) === launchMargin && launchMargin !== annualMargin,
    `${quote.json?.data?.target_margin_rate} → ${switched.json?.data?.target_margin_rate}（期望 ${typeMargin.get('product_launch')}）`,
  );
  // 换回去，后面按年会这张单继续跑
  await call('PATCH', `/quotes/${qid}`, { as: 'admin', body: { project_type: 'annual_meeting' } });

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

  // 6b. 攒单的对客价从哪来。
  //     真实反馈：勾了物料点「攒进报价单」，提示成功、右侧列表还是空的。
  //     根因不是取价失败，而是**对客价是成本按单头毛利率反推的**——新建单没有毛利率，
  //     服务端整批 40001 拒绝，前端却在请求发出前就弹了「已攒进 N 项」。
  //     这里把服务端这一条契约钉死：没毛利率 → 明确拒绝；补上 → 同一批立刻能进。
  //     （原来建单时随手给了 sale_unit_price，所以这条路径从来没被走过。）
  const noMargin = await call('POST', '/quotes', {
    as: 'admin',
    body: { customer_name: '自检样例', event_name: '无毛利率单，跑完即删', valid_until: validUntil },
  });
  const nmId = noMargin.json?.data?.id;
  if (nmId) {
    const bareLine = {
      line_kind: 'material',
      item_id: truss.id,
      item_name_snapshot: truss.name,
      unit_snapshot: '套',
      qty: '1',
      cost_source: 'price_book',
      pricing_nature: 'custom_made',
    };
    const rejected = await call('POST', `/quotes/${nmId}/items/bulk`, { as: 'admin', body: { items: [bareLine] } });
    record(
      '攒单：没有目标毛利率时明确拒绝（不是静默失败）',
      rejected.json?.code === 40001 && String(rejected.json?.message ?? '').includes('毛利率'),
      `${rejected.status} ${rejected.json?.code} ${rejected.json?.message ?? ''}`,
    );

    await call('PATCH', `/quotes/${nmId}`, { as: 'admin', body: { target_margin_rate: '0.4' } });
    const accepted = await call('POST', `/quotes/${nmId}/items/bulk`, { as: 'admin', body: { items: [bareLine] } });
    const first = accepted.json?.data?.items?.[0];
    const cost = Number(first?.cost_unit_price ?? 0);
    const sale = Number(first?.sale_unit_price ?? 0);
    record(
      '攒单：设了毛利率后同一行能进单，且对客价按毛利率反推',
      accepted.json?.code === 0 && cost > 0 && Math.abs(sale - cost / 0.6) < 0.01,
      accepted.json?.code === 0
        ? `成本 ${cost} → 对客 ${sale}（毛利率 40% 应为 ${(cost / 0.6).toFixed(4)}）`
        : `${accepted.json?.code} ${accepted.json?.message ?? ''}`,
    );

    // 改毛利率只影响之后攒进来的行，已有行要靠「按毛利率重算」——这条接口必须真的会改数
    await call('PATCH', `/quotes/${nmId}`, { as: 'admin', body: { target_margin_rate: '0.5' } });
    const recalc = await call('POST', `/quotes/${nmId}/apply-target-margin`, { as: 'admin', body: {} });
    const nextSale = Number(recalc.json?.data?.updated?.[0]?.new_sale_unit_price ?? 0);
    record(
      '改毛利率后「按毛利率重算」把已有行的对客价改掉',
      recalc.json?.code === 0 && nextSale > 0 && Math.abs(nextSale - cost / 0.5) < 0.01,
      `40% → 对客 ${sale}，改成 50% 重算后 → ${nextSale || '没变'}（应为 ${(cost / 0.5).toFixed(4)}）`,
    );
    await call('DELETE', `/quotes/${nmId}`, { as: 'admin' });
  } else {
    record('攒单：没有目标毛利率时明确拒绝（不是静默失败）', false, '建不出第二张草稿单');
    record('攒单：设了毛利率后同一行能进单，且对客价按毛利率反推', false, '同上');
    record('改毛利率后「按毛利率重算」把已有行的对客价改掉', false, '同上');
  }

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

  const memberPatch = await call('PATCH', `/items/${truss.id}`, { as: 'member', body: { name: truss.name } });
  record(
    '成员改档案被拒绝（40301）',
    memberPatch.json?.code === 40301,
    `${memberPatch.json?.code} ${memberPatch.json?.message ?? ''}`,
  );

  // 权限一旦能被编辑，就必须能被别人编辑不了：成员不能给自己升管理员
  const memberRoleEscalation = await call('PATCH', `/users/${mlogin.json?.data?.id ?? adminId}`, {
    as: 'member',
    body: { role: 'admin' },
  });
  record(
    '成员不能改权限（40301）',
    memberRoleEscalation.json?.code === 40301,
    `${memberRoleEscalation.json?.code} ${memberRoleEscalation.json?.message ?? ''}`,
  );
  if (firstSupplier) {
    const memberSupPatch = await call('PATCH', `/suppliers/${firstSupplier.id}`, {
      as: 'member',
      body: { name: firstSupplier.name },
    });
    record(
      '成员改供应商被拒绝（40301）',
      memberSupPatch.json?.code === 40301,
      `${memberSupPatch.json?.code} ${memberSupPatch.json?.message ?? ''}`,
    );
  } else {
    record('成员改供应商被拒绝（40301）', false, '没有可用的供应商 id，跳过');
  }
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

  // 12. 删除 vs 作废（v1.10）：删除是管理员专属，作废/恢复成员也能做。
  //     这条边界坏掉的方式很安静：成员点到了删除，或者成员建错的草稿永远清不掉。
  const mDelQuote = await call('DELETE', `/quotes/${quote.json?.data?.id}`, { as: 'member' });
  record(
    '成员删报价单被拒（40301）',
    mDelQuote.json?.code === 40301,
    `${mDelQuote.json?.code} ${mDelQuote.json?.message ?? ''}`,
  );

  const mDelItem = await call('DELETE', `/items/${truss.id}`, { as: 'member' });
  record('成员删物料被拒（40301）', mDelItem.json?.code === 40301, `${mDelItem.json?.code} ${mDelItem.json?.message ?? ''}`);

  // 作废/恢复整轮跑通，跑完把 truss 还原成在用状态
  const mArcItem = await call('POST', `/items/${truss.id}/archive`, { as: 'member' });
  const hiddenAfterArchive = await call('GET', `/items?item_type=material&limit=100`, { as: 'admin' });
  const inActiveList = (hiddenAfterArchive.json?.data?.items ?? []).some((x) => x.id === truss.id);
  const allList = await call('GET', `/items?item_type=material&is_active=all&limit=100`, { as: 'admin' });
  const inAllList = (allList.json?.data?.items ?? []).some((x) => x.id === truss.id);
  const mResItem = await call('POST', `/items/${truss.id}/restore`, { as: 'member' });
  record(
    '成员能作废物料：默认列表看不见、含已作废里还在、能恢复',
    mArcItem.json?.data?.is_active === false &&
      !inActiveList &&
      inAllList &&
      mResItem.json?.data?.is_active === true,
    `作废=${mArcItem.json?.data?.is_active} 默认里=${inActiveList} 全部里=${inAllList} 恢复=${mResItem.json?.data?.is_active}`,
  );

  if (priceId) {
    const mDelPrice = await call('DELETE', `/prices/${priceId}`, { as: 'member' });
    record(
      '成员删价格被拒（40301）',
      mDelPrice.json?.code === 40301,
      `${mDelPrice.json?.code} ${mDelPrice.json?.message ?? ''}`,
    );
    const mArcPrice = await call('POST', `/prices/${priceId}/archive`, { as: 'member', body: { reason: '自检' } });
    const mResPrice = await call('POST', `/prices/${priceId}/restore`, { as: 'member' });
    record(
      '成员能作废并恢复价格（撞同口径时 40902 并说明原因）',
      mArcPrice.json?.data?.status === 'archived' && (mResPrice.json?.code === 0 || mResPrice.json?.code === 40902),
      `作废=${mArcPrice.json?.data?.status} 恢复=${mResPrice.json?.code === 0 ? 'ok' : mResPrice.json?.message}`,
    );
  }
  if (firstSupplier) {
    const mDelSup = await call('DELETE', `/suppliers/${firstSupplier.id}`, { as: 'member' });
    record(
      '成员删供应商被拒（40301）',
      mDelSup.json?.code === 40301,
      `${mDelSup.json?.code} ${mDelSup.json?.message ?? ''}`,
    );
  }

  // 13. 分类字典可维护（v1.10）：管理员能新增+改名，成员不能
  const stamp = String(Date.now()).slice(-5);
  const newCat = await call('POST', '/categories', { as: 'admin', body: { domain: 'material', name: `自检分类${stamp}` } });
  const catId = newCat.json?.data?.id;
  record('管理员能新增分类', Boolean(catId), newCat.json?.message ?? '');
  if (catId) {
    const renamed = await call('PATCH', `/categories/${catId}`, { as: 'admin', body: { name: `自检改名${stamp}` } });
    record('管理员能改分类名', renamed.json?.data?.name === `自检改名${stamp}`, renamed.json?.data?.name ?? '');
    const byMember = await call('PATCH', `/categories/${catId}`, { as: 'member', body: { name: '成员改的' } });
    record('成员改分类被拒（40301）', byMember.json?.code === 40301, `${byMember.json?.code} ${byMember.json?.message ?? ''}`);
    await call('DELETE', `/categories/${catId}`, { as: 'admin' });
  }

  // 14. 客户版版面只有一个来源（v1.12）。
  //     客户原话"打印和导出客户版 PDF 按钮，打印出来的页面要跟 EXCEL 保持一致"。
  //     这类问题在浏览器里只能靠人眼比对两张纸，所以从接口层验：预览页那四个版式开关
  //     是不是真的传到了导出渲染器，导出的表是不是跟着开关变（不是照旧出全表）。
  const ExcelJS = (await import('exceljs')).default;
  async function readXlsx(query) {
    const res = await fetch(`${BASE}/api/v1/quotes/${qid}/export.xlsx?${query}`, {
      headers: { Cookie: jar.admin ?? '' },
    });
    const wb = new ExcelJS.Workbook();
    if (res.status === 200) await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const rows = [];
    wb.getWorksheet(1)?.eachRow((row) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (c) => cells.push(String(c.value ?? '').trim()));
      rows.push(cells);
    });
    return { status: res.status, rows };
  }
  const detailed = await readXlsx('view=customer');
  const brief = await readXlsx('view=customer&layout=brief&grouped=0&unit_price=0&discount=0');
  const headOf = (r) => r.rows.find((x) => x.includes('序号')) ?? [];
  const hasTxt = (r, t) => r.rows.some((x) => x.includes(t));
  const isGroupRow = (x) => /^[一二三四五六七八九十]、/.test(x[0] ?? '');
  const dHead = headOf(detailed);
  const bHead = headOf(brief);
  record(
    '导出：详细档有「规格 / 说明」「单价」两列',
    dHead.includes('规格 / 说明') && dHead.includes('单价'),
    dHead.join(' | ') || '没找到表头行',
  );
  record(
    '导出：精简档按参数收窄成 5 列（无规格、无单价），不是照旧出全表',
    bHead.length === 5 && !bHead.includes('单价') && !bHead.includes('规格 / 说明'),
    bHead.join(' | ') || '没找到表头行',
  );
  record(
    '导出：分组开关生效（详细档有「一、」分组行，关掉后没有）',
    detailed.rows.some(isGroupRow) && !brief.rows.some(isGroupRow),
    `详细档分组行 ${detailed.rows.filter(isGroupRow).length} 行`,
  );
  record(
    '导出：关掉优惠后合计标签降级为「合计」',
    hasTxt(brief, '合计') && !hasTxt(brief, '报价合计'),
    '优惠不显示时若仍标「报价合计」，客户会拿它再减一次优惠',
  );

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
