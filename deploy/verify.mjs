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

/**
 * 本地时区的 yyyy-mm-dd。
 *
 * 不要用 `new Date().toISOString().slice(0,10)`：那是 UTC 日期，而服务端 `db.ts` 的
 * `today()` 取的是**本地**日期。在 GMT+8 的 00:00–07:59 之间两者差一天，于是
 * 「报价日期」「开票日期」这类比对会每天红 8 小时 —— 一个每天必红的闸门，
 * 人会习惯性忽略红灯，真出事那天也没人看。
 */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  //     登录名固定成 selfcheck_temp：停用是软删（台账要留署名），删不掉，所以**首次建、之后复用**。
  //     早先用时间戳命名，跑十次「设置 / 账号」里就多十行「自检临时账号」，全是自检留下的垃圾。
  const adminId = login.json?.data?.id;
  const tmpLogin = 'selfcheck_temp';
  let created = await call('POST', '/users', {
    as: 'admin',
    body: { login: tmpLogin, name: '自检临时账号', password: 'selfcheck-2026', role: 'member' },
  });
  let tmpId = created.json?.data?.id;
  let reused = false;
  if (!tmpId) {
    const found = await call('GET', `/users?q=${tmpLogin}&is_active=0&limit=50`, { as: 'admin' });
    const hit = (found.json?.data?.items ?? []).find((u) => u.login === tmpLogin);
    if (hit) {
      tmpId = hit.id;
      reused = true;
    }
  }
  record(
    '管理员能新建账号',
    !!tmpId,
    reused ? '上次跑过，复用同一行 selfcheck_temp（不重复建）' : `${created.json?.code} ${created.json?.message ?? tmpLogin}`,
  );
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

  // 6b. 未选项目类型也要有默认毛利率（v1.16）。
  //     客户原话「项目类型未选，默认毛利率没有生效」。下拉上一直写着「未选（按默认 25%）」，
  //     而实际落库是 NULL —— 于是第一行加进来就报「这张单没有目标毛利率，无法反推」。
  //     默认值写在界面上却不算数，比不写更糟，所以从接口层钉住。
  const siteDefault = Number(qSettings.json?.data?.default_margin_threshold);
  const noType = await call('POST', '/quotes', {
    as: 'admin',
    body: {
      customer_name: '自检样例',
      event_name: '未选类型自检，跑完即删',
      valid_until: validUntil,
    },
  });
  record(
    '建单：未选项目类型时也落全站默认毛利率（不是 NULL）',
    Number.isFinite(siteDefault) &&
      siteDefault > 0 &&
      Math.abs(Number(noType.json?.data?.target_margin_rate) - siteDefault) < 1e-6,
    `target_margin_rate=${noType.json?.data?.target_margin_rate} / 全站默认=${qSettings.json?.data?.default_margin_threshold}`,
  );
  // 这张单只为这一项自检存在，验完立刻删：列表里多一张「自检样例」会让人分不清哪张是自己的
  if (noType.json?.data?.id) await call('DELETE', `/quotes/${noType.json.data.id}`, { as: 'admin' });

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
    // v1.16 起新建单一定落一个默认毛利率，所以"没毛利率"这个状态要显式清出来。
    // 它对应的是历史单：当年建单没带毛利率，target_margin_rate 是 NULL。
    // 服务端契约没变——这种单攒行必须明确拒绝，不能静默失败。
    await call('PATCH', `/quotes/${nmId}`, { as: 'admin', body: { target_margin_rate: null } });
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

  /**
   * 合同 / 发票整块只对管理员开放（2026-11-17）。
   *
   * 这两条必须测**读**，不只是测写：这轮改的就是"成员连看都不给"。
   * 只测 PATCH/DELETE 的话，把列表接口漏掉一样是绿的，而漏掉的正是数据出口。
   * 同时也测一遍管理员仍能读——权限收过头（比如判定函数写成恒 false）同样是事故。
   */
  const memberContracts = await call('GET', '/contracts?page=1', { as: 'member' });
  record(
    '成员看合同列表被拒（40301，不是空列表）',
    memberContracts.status === 403 && memberContracts.json?.code === 40301,
    `HTTP ${memberContracts.status} code=${memberContracts.json?.code} ${memberContracts.json?.message ?? ''}`,
  );
  const memberInvoices = await call('GET', '/invoices?page=1', { as: 'member' });
  record(
    '成员看发票列表被拒（40301，不是空列表）',
    memberInvoices.status === 403 && memberInvoices.json?.code === 40301,
    `HTTP ${memberInvoices.status} code=${memberInvoices.json?.code} ${memberInvoices.json?.message ?? ''}`,
  );
  const memberContractWrite = await call('POST', '/contracts', {
    as: 'member',
    body: { contract_no: 'SC-MEMBER-403', title: '自检不该建成的合同', category: 'other' },
  });
  record(
    '成员新建合同被拒（40301）',
    memberContractWrite.json?.code === 40301,
    `${memberContractWrite.json?.code} ${memberContractWrite.json?.message ?? ''}`,
  );
  const adminContracts = await call('GET', '/contracts?page=1', { as: 'admin' });
  record(
    '管理员仍能读合同列表（收权没收到自己人）',
    adminContracts.json?.code === 0 && Array.isArray(adminContracts.json?.data?.items),
    `${adminContracts.json?.code} 条数=${adminContracts.json?.data?.items?.length ?? '无'}`,
  );
  const adminInvoices = await call('GET', '/invoices?page=1', { as: 'admin' });
  record(
    '管理员仍能读发票列表',
    adminInvoices.json?.code === 0 && Array.isArray(adminInvoices.json?.data?.items),
    `${adminInvoices.json?.code} 条数=${adminInvoices.json?.data?.items?.length ?? '无'}`,
  );
  // 识别设置跟着收：成员走不到上传按钮了，这个口的开放理由也就不存在了
  const memberOcrSettings = await call('GET', '/settings/ocr', { as: 'member' });
  record(
    '成员读 OCR 设置被拒（40301）',
    memberOcrSettings.json?.code === 40301,
    `${memberOcrSettings.json?.code} ${memberOcrSettings.json?.message ?? ''}`,
  );

  const memberPatch = await call('PATCH', `/items/${truss.id}`, { as: 'member', body: { name: truss.name } });
  record(
    '成员改档案被拒绝（40301）',
    memberPatch.json?.code === 40301,
    `${memberPatch.json?.code} ${memberPatch.json?.message ?? ''}`,
  );

  // 10b. 建档 vs 改档（2026-11-17 客户要求：成员建不了物料 / 人员 / 供应商 / 报价）。
  //      这条边界有两半，必须一起测：建档真的开了，改档真的**没**跟着开。
  //      只测前一半的话，把 canManageCatalog 一起放开也能过 —— 而那正是不能发生的事：
  //      成员把「桁架 3m」改名后，历史报价单里那行还指着它，同一个东西从此两个名字。
  const memStamp = String(Date.now()).slice(-5);
  const memCat = truss.category_id;
  const mItem = await call('POST', '/items', {
    as: 'member',
    body: {
      item_type: 'material',
      category_id: memCat,
      name: `成员建的物料${memStamp}`,
      base_unit_code: 'sqm',
      spec: '自检',
    },
  });
  record(
    '成员能新建物料（201，不再 40301）',
    mItem.status === 201 && Boolean(mItem.json?.data?.id),
    `HTTP ${mItem.status} ${mItem.json?.code ?? ''} ${mItem.json?.message ?? mItem.json?.data?.name ?? ''}`,
  );

  /**
   * 人员与物料共用 items 表、共用同一支 POST，但分类是两棵树：
   * 拿 material 的分类 id 去建 personnel，会被分类域校验拦下（400）——那不是权限问题，
   * 所以这里单独取一个 personnel 分类。取不到就记失败而不是记通过：
   * 跳过的项被当成通过，正是自检开始骗人的第一步。
   */
  const personCats = await call('GET', '/categories?domain=personnel&include_counts=false', { as: 'member' });
  const personCatId = Array.isArray(personCats.json?.data) ? personCats.json?.data?.[0]?.id : null;
  const mPerson = await call('POST', '/items', {
    as: 'member',
    body: {
      item_type: 'personnel',
      category_id: personCatId,
      name: `成员建的人员${memStamp}`,
      base_unit_code: 'session',
    },
  });
  record(
    '成员能新建人员（人员库走同一支 POST）',
    mPerson.status === 201 && Boolean(mPerson.json?.data?.id),
    `HTTP ${mPerson.status} ${mPerson.json?.code ?? ''} ${mPerson.json?.message ?? mPerson.json?.data?.name ?? ''}`,
  );

  const mSup = await call('POST', '/suppliers', {
    as: 'member',
    body: { name: `成员建的供应商${memStamp}`, type: 'factory' },
  });
  record(
    '成员能新建供应商（201，不再 40301）',
    mSup.status === 201 && Boolean(mSup.json?.data?.id),
    `HTTP ${mSup.status} ${mSup.json?.code ?? ''} ${mSup.json?.message ?? mSup.json?.data?.name ?? ''}`,
  );

  const mPrice = await call('POST', '/prices', {
    as: 'member',
    body: {
      item_id: mItem.json?.data?.id,
      supplier_id: mSup.json?.data?.id,
      unit_code: 'sqm',
      // 不填折算系数：单位的基准单位就是 sqm，填 1 会被 42201 拦下
      // （「1 等于说两个单位相同」——那条校验是对的，别为了过自检去绕它）
      unit_price: '88.88',
      tax_included: true,
      pricing_nature: 'purchase',
      effective_from: new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10),
      close_previous: false,
    },
  });
  record(
    '成员能录物料报价（引用自己刚建的物料与供应商）',
    mPrice.status === 201 && Boolean(mPrice.json?.data?.id),
    `HTTP ${mPrice.status} ${mPrice.json?.code ?? ''} ${mPrice.json?.message ?? mPrice.json?.data?.unit_price ?? ''}`,
  );

  // 另一半：改档仍然关门（上面 584 行那条测的是已有主体，这里测成员改自己刚建的那条）
  const mEditOwn = await call('PATCH', `/items/${mItem.json?.data?.id}`, {
    as: 'member',
    body: { name: `成员改自己的${memStamp}` },
  });
  record(
    '成员改档案（含自己刚建的）仍被拒（40301）',
    mEditOwn.json?.code === 40301,
    `${mEditOwn.json?.code} ${mEditOwn.json?.message ?? ''}`,
  );

  // 收尾：自检造的数据不许留在台账里（物料/供应商都是 DELETE 才干净，作废仍会出现在"含已作废"）
  if (mPrice.json?.data?.id) await call('DELETE', `/prices/${mPrice.json.data.id}`, { as: 'admin' });
  if (mItem.json?.data?.id) await call('DELETE', `/items/${mItem.json.data.id}`, { as: 'admin' });
  if (mPerson.json?.data?.id) await call('DELETE', `/items/${mPerson.json.data.id}`, { as: 'admin' });
  if (mSup.json?.data?.id) await call('DELETE', `/suppliers/${mSup.json.data.id}`, { as: 'admin' });

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
  async function readXlsx(query, id = qid) {
    const res = await fetch(`${BASE}/api/v1/quotes/${id}/export.xlsx?${query}`, {
      headers: { Cookie: jar.admin ?? '' },
    });
    const wb = new ExcelJS.Workbook();
    if (res.status === 200) await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const rows = [];
    // wraps 与 rows 逐格对齐：同一个 eachCell 里顺手记下 wrapText，
    // 用来验「备注列真的开了自动换行」——这件事只看单元格文字看不出来
    const wraps = [];
    wb.getWorksheet(1)?.eachRow((row) => {
      const cells = [];
      const w = [];
      row.eachCell({ includeEmpty: false }, (c) => {
        cells.push(String(c.value ?? '').trim());
        w.push(c.alignment?.wrapText === true);
      });
      rows.push(cells);
      wraps.push(w);
    });
    return { status: res.status, rows, wraps, ws: wb.getWorksheet(1) };
  }
  const detailed = await readXlsx('view=customer');
  const brief = await readXlsx('view=customer&layout=brief&grouped=0&unit_price=0&discount=0');
  const headOf = (r) => r.rows.find((x) => x.includes('序号')) ?? [];
  // 注意：这里是"某个单元格里含这段字"，不是"某一行有这一整格"。
  // 抬头第 4 行印的是「报价人：管理员」，整格比对会假失败。
  const hasTxt = (r, t) => r.rows.some((x) => x.some((c) => String(c).includes(t)));
  const isGroupRow = (x) => /^[一二三四五六七八九十]、/.test(x[0] ?? '');
  const dHead = headOf(detailed);
  const bHead = headOf(brief);
  record(
    '导出：详细档「规格」与「备注」是两列（不是合成「规格 / 说明」），且都有单价',
    dHead.includes('规格') && dHead.includes('备注') && dHead.includes('单价') && !dHead.includes('规格 / 说明'),
    dHead.join(' | ') || '没找到表头行',
  );
  record(
    '导出：备注在小计之后，是整张表的最后一列',
    dHead[dHead.length - 1] === '备注' && dHead.indexOf('备注') === dHead.indexOf('小计') + 1,
    dHead.join(' | ') || '没找到表头行',
  );
  // 这一条原来断言的是"精简档收窄成 5 列"。0.1.21 引入多报价单模板后，规则变了：
  // `customer-sheet.ts:296` 写明「有模板时列集合由模板决定，详细/精简开关随之失效」——
  // 默认模板 8 列必然盖掉 layout=brief，这是**刻意设计**，不是 bug。
  // 所以这条不再验"精简"，改成钉住模板优先级：brief 与 detailed 必须一模一样，
  // 且含规格/备注/单价三个只有模板才给的列。哪天有人把开关做成"半生效"（比如单价
  // 能被 unit_price=0 关掉），这里就会红 —— 而不是让差异悄悄出现在客户收到的 Excel 里。
  record(
    '导出：有模板时列集合由模板决定（详细/精简开关不生效）',
    bHead.join('|') === dHead.join('|') &&
      bHead.length === 8 &&
      bHead.includes('规格') &&
      bHead.includes('备注') &&
      bHead.includes('单价'),
    `brief=${bHead.join(' | ') || '无表头'}｜与 detailed ${bHead.join('|') === dHead.join('|') ? '一致' : '不一致'}`,
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

  // 15. 报价人抬头 / 物料人员备注 / 列表草稿优先（v1.13）
  //     三条都是"界面上看着对、接口其实没给"的类型，所以在这里从数据层钉住。
  const usersBefore = await call('GET', '/users?limit=50', { as: 'admin' });
  const meRow = (usersBefore.json?.data?.items ?? []).find((u) => u.id === adminId);
  const oldPhone = meRow?.phone ?? null;
  const operatorRow = detailed.rows.find((x) => x.some((c) => String(c).startsWith('报价人：'))) ?? [];
  record(
    '客户版抬头印了报价人姓名与电话',
    // 管理员没填电话时，抬头只该有姓名那一格，不该出现空的「联系电话：」
    hasTxt(detailed, '报价人：') && (oldPhone ? hasTxt(detailed, '联系电话：') : !hasTxt(detailed, '联系电话：')),
    operatorRow.length ? operatorRow.join(' / ') : '抬头里找不到「报价人：」',
  );

  const listAll = await call('GET', '/quotes?limit=20', { as: 'admin' });
  const statusSeq = (listAll.json?.data?.items ?? []).map((x) => x.status);
  const lastDraftAt = statusSeq.lastIndexOf('draft');
  const firstSettledAt = statusSeq.findIndex((s) => s !== 'draft');
  record(
    '列表默认返回全部状态，且草稿排在已发出/已作废之前',
    statusSeq.includes('draft') &&
      statusSeq.includes('issued') &&
      (firstSettledAt === -1 || lastDraftAt < firstSettledAt),
    statusSeq.join(' → ') || '列表空',
  );

  const phoneSet = await call('PATCH', `/users/${adminId}`, { as: 'admin', body: { phone: '138-0000-0009' } });
  record(
    '账号电话可写（抬头印的就是这个号，不是公司电话）',
    phoneSet.json?.data?.phone === '138-0000-0009',
    phoneSet.json?.data?.phone ?? phoneSet.json?.message ?? '',
  );
  await call('PATCH', `/users/${adminId}`, { as: 'admin', body: { phone: oldPhone } });

  if (truss) {
    const noteText = `自检备注${stamp}：报价含运输不含电费`;
    const oldNote = truss.note ?? null;
    await call('PATCH', `/items/${truss.id}`, { as: 'admin', body: { note: noteText } });
    const noteBack = await call('GET', `/items/${truss.id}`, { as: 'admin' });
    record('物料/人员备注能存能读', noteBack.json?.data?.note === noteText, noteBack.json?.data?.note ?? '');

    const nq = await call('POST', '/quotes', {
      as: 'admin',
      body: { customer_name: '自检样例', event_name: '备注自检，跑完即删', valid_until: validUntil },
    });
    const nqId = nq.json?.data?.id;
    const nl = nqId
      ? await call('POST', `/quotes/${nqId}/items`, {
          as: 'admin',
          body: {
            line_kind: 'material',
            item_id: truss.id,
            item_name_snapshot: truss.name,
            unit_snapshot: '套',
            qty: '1',
            cost_source: 'manual',
            cost_unit_price: '100',
            sale_unit_price: '160',
            pricing_nature: 'custom_made',
          },
        })
      : null;
    const lineId = nl?.json?.data?.item?.id;
    record(
      '加行：行备注默认带出物料/人员备注',
      nl?.json?.data?.item?.remark === noteText,
      `行备注=${nl?.json?.data?.item?.remark ?? '空'}`,
    );

    // 客户版 Excel 里规格与备注必须落在**不同两格**：合成一格时客户分不清
    // 哪句是参数、哪句是条件，长备注还会把规格挤没
    if (nqId) {
      const nqXls = await readXlsx('view=customer', nqId);
      const nxHead = headOf(nqXls);
      const specAt = nxHead.indexOf('规格');
      const remarkAt = nxHead.indexOf('备注');
      const nameAt = nxHead.indexOf('项目');
      const amountAt = nxHead.indexOf('小计');
      const noteIdx = nqXls.rows.findIndex((x) => x.includes(noteText));
      const noteRow = noteIdx >= 0 ? nqXls.rows[noteIdx] : [];
      const noteWrap = (noteIdx >= 0 ? nqXls.wraps[noteIdx] : []) ?? [];
      record(
        '导出：规格与备注分两列落值，项目名不再驮括号',
        specAt > -1 &&
          remarkAt > -1 &&
          noteRow.length > 0 &&
          noteRow[remarkAt] === noteText &&
          !String(noteRow[nameAt] ?? '').includes(noteText) &&
          (truss.spec ? noteRow[specAt] === truss.spec : true),
        noteRow.length ? noteRow.join(' | ') : '导出里找不到这条备注',
      );
      // 「备注太长要自动换行」在 Excel 里是单元格属性，不是内容：不设 wrapText 时
      // 长备注要么被邻格压住，要么被截断，而打印出来和纸面对不上
      record(
        '导出：备注格开了自动换行，金额格没有（金额折行会断在逗号处）',
        noteWrap[remarkAt] === true && amountAt > -1 && noteWrap[amountAt] === false,
        `备注 wrap=${noteWrap[remarkAt]} 小计 wrap=${noteWrap[amountAt]}`,
      );
      // 备注在小计右边：合并合计行时不能把它一起吞掉，否则金额会印到备注列下面
      record(
        '导出：合计与优惠的金额仍落在「小计」列，没有被备注列挤位',
        (() => {
          const totalRow = nqXls.rows.find((x) => x.some((c) => /^(报价)?合计$/.test(String(c))));
          if (!totalRow) return false;
          const idx = nqXls.rows.indexOf(totalRow);
          const cells = nqXls.ws?.getRow(idx + 1);
          if (!cells) return false;
          const at = cells.getCell(amountAt + 1).value;
          return typeof at === 'number' && at > 0;
        })(),
        '合计金额必须写在「小计」那一格（合并区只保留左上角的值，写错格会静默消失）',
      );
    }

    if (nqId && lineId) {
      const patchBody = {
        line_kind: 'material',
        item_name_snapshot: truss.name,
        unit_snapshot: '套',
        qty: '1',
        cost_source: 'manual',
      };
      await call('PATCH', `/quotes/${nqId}/items/${lineId}`, {
        as: 'admin',
        body: { ...patchBody, remark: '单内改过，只影响这张单' },
      });
      const itemNow = await call('GET', `/items/${truss.id}`, { as: 'admin' });
      record(
        '改行备注不回写物料库（同一句备注在两处各自独立）',
        itemNow.json?.data?.note === noteText,
        itemNow.json?.data?.note ?? '',
      );

      // 清空是清空：不能被物料备注在下次保存时又填回来
      await call('PATCH', `/quotes/${nqId}/items/${lineId}`, { as: 'admin', body: { ...patchBody, remark: '' } });
      const cleared = await call('GET', `/quotes/${nqId}`, { as: 'admin' });
      record(
        '行备注能清空，不会被物料备注重新填回',
        (cleared.json?.data?.items ?? [])[0]?.remark === null,
        `remark=${JSON.stringify((cleared.json?.data?.items ?? [])[0]?.remark)}`,
      );

      await call('DELETE', `/quotes/${nqId}`, { as: 'admin' });
    } else {
      record('加行：行备注默认带出物料/人员备注', false, nl?.json?.message ?? '临时单没建出来');
      record('改行备注不回写物料库（同一句备注在两处各自独立）', false, '同上');
      record('行备注能清空，不会被物料备注重新填回', false, '同上');
    }
    await call('PATCH', `/items/${truss.id}`, { as: 'admin', body: { note: oldNote } });
  } else {
    record('物料/人员备注能存能读', false, '没找到示例主体「桁架背景板」');
    record('加行：行备注默认带出物料/人员备注', false, '同上');
    record('改行备注不回写物料库（同一句备注在两处各自独立）', false, '同上');
    record('行备注能清空，不会被物料备注重新填回', false, '同上');
  }

  // 16. 录价的默认税口径（v1.15）
  //     客户原话「物料和人员的报价默认都是含税价」。这条最容易只改一半：
  //     界面默认含税、接口默认不含税，或者反过来——两边不一致时，用户点保存那一刻是对的，
  //     第二天从别处录进来的价就躺在另一侧，而取价按口径严格匹配、不回落，
  //     结果是含税单子里"没有有效价格"，人却找不到原因。
  //     所以这里不验界面，直接验接口：**不传 tax_included 时落库必须是真的**。
  const basisFrom = new Date().toISOString().slice(0, 10);
  const basisTo = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const basisSup = await call('POST', '/suppliers', {
    as: 'admin',
    body: { name: `自检口径供应商${stamp}`, type: 'factory' },
  });
  const basisSupId = basisSup.json?.data?.id;
  if (basisSupId) {
    const baseBody = {
      item_id: truss.id,
      supplier_id: basisSupId,
      unit_code: 'set',
      base_unit_qty: '0.055556',
      pricing_nature: 'purchase',
      unit_price: '100',
      effective_from: basisFrom,
      effective_to: basisTo,
    };
    const noTax = await call('POST', '/prices', { as: 'admin', body: baseBody });
    // 同一主体、同一供应商、同一段期，但税口径不同 —— 重叠判定把它当另一条价，所以不会撞车
    const explicitNo = await call('POST', '/prices', { as: 'admin', body: { ...baseBody, tax_included: false } });
    // 直接用录价接口的返回，不再查一遍列表：用户点保存后看到的就是这个对象
    record(
      '录价不传税口径时默认按含税记（物料与人员同一套接口）',
      noTax.json?.data?.tax_included === true,
      `tax_included=${noTax.json?.data?.tax_included} ${noTax.json?.message ?? ''}`,
    );
    record(
      '显式传 tax_included=false 时仍能记成不含税（默认值不许盖掉用户的选择）',
      explicitNo.json?.data?.tax_included === false,
      `tax_included=${explicitNo.json?.data?.tax_included} ${explicitNo.json?.message ?? ''}`,
    );
    for (const p of [noTax.json?.data, explicitNo.json?.data]) {
      if (p?.id) await call('DELETE', `/prices/${p.id}`, { as: 'admin' });
    }
    await call('DELETE', `/suppliers/${basisSupId}`, { as: 'admin' });
  } else {
    record('录价不传税口径时默认按含税记（物料与人员同一套接口）', false, basisSup.json?.message ?? '临时供应商没建出来');
    record('显式传 tax_included=false 时仍能记成不含税（默认值不许盖掉用户的选择）', false, '同上');
  }

  // 15. 报价单模板 / 报价有效期 / 删除成员（v1.21）
  //     这三项的共同点是「改设置不许影响已经发出的单」——
  //     靠人眼看是看不出来的，只能拿一张单出来，改设置、再读它，比对同一组值。
  const tplStamp = String(Date.now()).slice(-5);
  const originalSettings = await call('GET', '/settings/quote', { as: 'admin' });
  const originalDays = originalSettings.json?.data?.valid_days;
  const patchedDays = await call('PATCH', '/settings/quote', { as: 'admin', body: { valid_days: 45 } });
  const rereadDays = await call('GET', '/settings/quote', { as: 'admin' });
  record(
    '报价有效期天数可改并能读回',
    patchedDays.json?.data?.valid_days === 45 && rereadDays.json?.data?.valid_days === 45,
    `写入=${patchedDays.json?.data?.valid_days} 读回=${rereadDays.json?.data?.valid_days}`,
  );
  const badDays = await call('PATCH', '/settings/quote', { as: 'admin', body: { valid_days: 0 } });
  record('有效期 0 天被拒（1~365）', badDays.status === 400, badDays.json?.message ?? '');
  if (typeof originalDays === 'number') {
    await call('PATCH', '/settings/quote', { as: 'admin', body: { valid_days: originalDays } });
  }

  const newTpl = await call('POST', '/quote-templates', {
    as: 'admin',
    body: { name: `自检模板${tplStamp}`, supplier_name: `自检供应商${tplStamp}` },
  });
  const tplId = newTpl.json?.data?.id;
  record('管理员能新建报价单模板', Boolean(tplId), newTpl.json?.message ?? '');
  if (tplId) {
    const dup = await call('POST', '/quote-templates', {
      as: 'admin',
      body: { name: `自检模板${tplStamp}`, supplier_name: 'x' },
    });
    record('同名模板被拒（409，不是静默覆盖）', dup.status === 409, dup.json?.message ?? '');

    const memberTplList = await call('GET', '/quote-templates?active_only=1', { as: 'member' });
    const memberCreateTpl = await call('POST', '/quote-templates', {
      as: 'member',
      body: { name: `成员模板${tplStamp}`, supplier_name: 'x' },
    });
    record(
      '成员能读模板列表（建单要选）、但不能建模板（40301）',
      Array.isArray(memberTplList.json?.data?.items) && memberCreateTpl.json?.code === 40301,
      `${memberTplList.json?.data?.items?.length ?? '?'} 个 / ${memberCreateTpl.json?.code}`,
    );

    // 用这个模板建一张单，供应商名称必须当场快照进单据
    const tplQuote = await call('POST', '/quotes', {
      as: 'admin',
      body: {
        customer_name: '自检模板客户',
        event_name: '自检模板活动',
        valid_until: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
        template_id: tplId,
      },
    });
    const tplQuoteId = tplQuote.json?.data?.id;
    const todayStr = localDate();
    record(
      '建单时把模板的供应商名称快照进单据（含报价日期）',
      tplQuote.json?.data?.template_supplier_name === `自检供应商${tplStamp}` &&
        tplQuote.json?.data?.quote_date === todayStr,
      `供应商=${tplQuote.json?.data?.template_supplier_name} 报价日期=${tplQuote.json?.data?.quote_date}`,
    );

    await call('PATCH', `/quote-templates/${tplId}`, { as: 'admin', body: { supplier_name: '改过的供应商名' } });
    const afterTplEdit = await call('GET', `/quotes/${tplQuoteId}`, { as: 'admin' });
    record(
      '改模板不回写已经建好的单（快照不是视图）',
      afterTplEdit.json?.data?.template_supplier_name === `自检供应商${tplStamp}`,
      afterTplEdit.json?.data?.template_supplier_name ?? '',
    );

    const delTpl = await call('DELETE', `/quote-templates/${tplId}`, { as: 'admin' });
    const afterTplDelete = await call('GET', `/quotes/${tplQuoteId}`, { as: 'admin' });
    record(
      '删模板后老单抬头仍印原供应商（只有 template_id 置空）',
      delTpl.json?.data?.deleted === true &&
        afterTplDelete.json?.data?.template_supplier_name === `自检供应商${tplStamp}` &&
        afterTplDelete.json?.data?.template_id === null,
      `删=${delTpl.json?.data?.deleted} 供应商=${afterTplDelete.json?.data?.template_supplier_name}`,
    );

    const list = await call('GET', '/quote-templates', { as: 'admin' });
    const stillThere = (list.json?.data?.items ?? []).some((t) => t.id === tplId);
    record('删掉的模板不再出现在列表里', !stillThere, `仍在=${stillThere}`);

    if (tplQuoteId) await call('DELETE', `/quotes/${tplQuoteId}`, { as: 'admin' });
  }

  const tpls = await call('GET', '/quote-templates', { as: 'admin' });
  const defaultTpl = (tpls.json?.data?.items ?? []).find((t) => t.is_default);
  if (defaultTpl) {
    const delDefault = await call('DELETE', `/quote-templates/${defaultTpl.id}`, { as: 'admin' });
    record('默认模板不能删（409，先指别的为默认）', delDefault.status === 409, delDefault.json?.message ?? '');
  }

  // 删除成员：无单可删、有单拦住、管理员一律删不得
  const delTag = String(Date.now()).slice(-5);
  const mkUser = (login, role = 'member') =>
    call('POST', '/users', {
      as: 'admin',
      body: { login, name: `自检${login}`, password: 'SelfcheckPass2026', role },
    });
  const loner = await mkUser(`selfcheck_del_${delTag}`);
  const lonerId = loner.json?.data?.id;
  const delLoner = lonerId ? await call('DELETE', `/users/${lonerId}?hard=1`, { as: 'admin' }) : null;
  const lonerBack = await call('GET', `/users?q=selfcheck_del_${delTag}`, { as: 'admin' });
  record(
    '名下没有单据的普通成员可以真删',
    delLoner?.json?.data?.deleted === true && (lonerBack.json?.data?.items ?? []).length === 0,
    `${delLoner?.json?.code} / 剩余=${(lonerBack.json?.data?.items ?? []).length}`,
  );

  const owner = await mkUser(`selfcheck_own_${delTag}`);
  const ownerId = owner.json?.data?.id;
  if (ownerId) {
    // 用这个成员的身份建一张单：真删必须被拦（created_by 会 SET NULL，署名永久丢失）
    const asOwner = await call('POST', '/auth/login', {
      as: 'owner',
      body: { login: owner.json?.data?.login, password: 'SelfcheckPass2026' },
    });
    const ownerQuote = await call('POST', '/quotes', {
      as: 'owner',
      body: {
        customer_name: '自检删人客户',
        event_name: '自检删人活动',
        valid_until: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
      },
    });
    const ownerQuoteId = ownerQuote.json?.data?.id;
    const delOwner = await call('DELETE', `/users/${ownerId}?hard=1`, { as: 'admin' });
    record(
      '名下有报价单的成员真删被拦（409 并说明张数）',
      delOwner.status === 409 && /\d+ 张报价单/.test(delOwner.json?.message ?? ''),
      delOwner.json?.message ?? `code=${delOwner.json?.code}`,
    );
    const softDel = await call('DELETE', `/users/${ownerId}`, { as: 'admin' });
    record(
      '同一个账号仍可停用（默认 DELETE 语义没被真删顶掉）',
      softDel.json?.data?.is_active === false,
      JSON.stringify(softDel.json?.data ?? softDel.json?.message),
    );
    void asOwner;
    if (ownerQuoteId) await call('DELETE', `/quotes/${ownerQuoteId}`, { as: 'admin' });
    // 单据删掉后就能真删了（这也说明拦住的是"有单据"，不是"这个人")
    const delOwnerRetry = await call('DELETE', `/users/${ownerId}?hard=1`, { as: 'admin' });
    record(
      '单据清掉后同一个成员可以真删',
      delOwnerRetry.json?.data?.deleted === true,
      delOwnerRetry.json?.message ?? JSON.stringify(delOwnerRetry.json?.data),
    );
  }

  const tempAdmin = await mkUser(`selfcheck_adm_${delTag}`, 'admin');
  const tempAdminId = tempAdmin.json?.data?.id;
  if (tempAdminId) {
    const delAdmin = await call('DELETE', `/users/${tempAdminId}?hard=1`, { as: 'admin' });
    record('管理员账号不能真删（先降权或停用）', delAdmin.status === 409, delAdmin.json?.message ?? '');
    await call('PATCH', `/users/${tempAdminId}`, { as: 'admin', body: { role: 'member' } });
    await call('DELETE', `/users/${tempAdminId}?hard=1`, { as: 'admin' });
  }

  // 16. 发票台账 + 合同状态（v0.1.35）
  //     前面一百多项一条都没碰过发票，而这一块的错法全是"不报错的错数"：
  //     同号票被吞掉、冲红符号没归一、summary 和 items 各查一遍对不上、勾选下载下了整批。
  //     每条都拿本脚本自己造的票验证，用购买方名里的 stamp 圈出一小片数据集，
  //     跑完自己删干净（本段末尾就清，不依赖下面的自检单清理逻辑）。
  const invStamp = String(Date.now()).slice(-6);
  const invBuyer = `自检购买方${invStamp}中间段`;
  const invSeller = `自检销售方${invStamp}`;
  const invNo = (n) => `88${invStamp}${String(n).padStart(2, '0')}`;
  // 日期一律走顶层的 localDate()（本地时区，与服务端 today() 同口径）
  const invToday = localDate();
  const invYesterday = localDate(new Date(Date.now() - 864e5));

  // 金额一律定点比较：Number('1900.10') + Number('0.20') 是 1900.2999999999997，
  // 浮点做这类断言会偶发假失败。脚本里不能 import TS 模块，所以这 20 行就地写。
  const centsOf = (v) => {
    const s = String(v ?? '0').trim();
    const neg = s.startsWith('-');
    const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
    const c = BigInt(i || '0') * 100n + BigInt((`${f}00`).slice(0, 2));
    return neg ? -c : c;
  };
  const fmtCents = (c) => {
    const neg = c < 0n;
    const a = neg ? -c : c;
    return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
  };
  const sumCents = (arr) => arr.reduce((acc, v) => acc + centsOf(v), 0n);

  const invCreate = (extra) =>
    call('POST', '/invoices', {
      as: 'admin',
      body: { buyer_name: invBuyer, seller_name: invSeller, issued_on: invToday, ...extra },
    });

  // 16.1 同号不同代码必须是两张票
  //      按「发票号」单列判重会吞掉别家真票：8 位号在纸质票里跨省重号是常态，
  //      而吞掉的票没有任何报错，只表现为"这家的票录不进去"。
  // 号码带 stamp：软删的发票仍然占着 (code, no) 这个唯一键（删了不会腾出号来），
  // 用固定号码的话第二次跑自检就会以 409 撞上上一次留下的那行，红得莫名其妙。
  const invSameA = await invCreate({ invoice_code: '011001900111', invoice_no: invNo(10), total_amount: '10.00' });
  const invSameB = await invCreate({ invoice_code: '022002900222', invoice_no: invNo(10), total_amount: '20.00' });
  record(
    '同号不同代码是两张票（唯一键是 code+no）',
    Boolean(invSameA.json?.data?.id) &&
      Boolean(invSameB.json?.data?.id) &&
      invSameA.json.data.id !== invSameB.json.data.id,
    `A=${invSameA.json?.code}/${String(invSameA.json?.data?.id ?? '').slice(0, 8)} B=${invSameB.json?.code}/${String(invSameB.json?.data?.id ?? '').slice(0, 8)}`,
  );

  // 16.1b 存量代码为空时，同号码的新票必须按重复处理（Spec §12-7「代码为空放宽匹配」）
  //       不修的话：第一次上传没认出代码存成 ''，重传时认出代码就会**新建一行**——
  //       同一张票两条记录，金额/税额/价税合计全部虚增，而且不会有任何报错。
  //       这一条与 16.1 互为对照：16.1（两个代码都非空）必须放行，这条必须拦住。
  //       两条一起才说明规则没有放宽过头变成"只看号码"（那会吞掉别家的真票）。
  const invBlankCode = await invCreate({ invoice_code: '', invoice_no: invNo(12), total_amount: '40.00' });
  const invBlankCodeDup = await invCreate({
    invoice_code: '033002100311',
    invoice_no: invNo(12),
    total_amount: '40.00',
  });
  record(
    '存量代码为空时同号码带代码重录被拒（409 / 40901）',
    Boolean(invBlankCode.json?.data?.id) && invBlankCodeDup.status === 409 && invBlankCodeDup.json?.code === 40901,
    `先建 code='' → ${invBlankCode.json?.code}；再建 code=033002100311 → ${invBlankCodeDup.status} ${invBlankCodeDup.json?.code} ${invBlankCodeDup.json?.message ?? ''}`,
  );

  // 16.2 同 code+no 再录一次必须被拒
  //      静默覆盖会让"上一次人工核对过的数"被悄悄改掉；回 500 则让人以为系统坏了。
  const invDup = await invCreate({ invoice_code: '011001900111', invoice_no: invNo(10), total_amount: '10.00' });
  record(
    '同 code+no 重复录入被拒（409 / 40901）',
    invDup.status === 409 && invDup.json?.code === 40901,
    `${invDup.status} ${invDup.json?.code} ${invDup.json?.message ?? ''}`,
  );

  // 16.3 全电票没有代码，必须存空串而不是 null
  //      唯一索引不认 NULL 相等（多行 NULL 互不冲突），存 null 等于同一张全电票能被反复录进去。
  const invElec = await invCreate({ invoice_code: '', invoice_no: invNo(11), total_amount: '30.00' });
  record(
    '全电票代码为空时存空串（不是 null）',
    invElec.json?.code === 0 && invElec.json?.data?.invoice_code === '',
    `code=${invElec.json?.code} invoice_code=${JSON.stringify(invElec.json?.data?.invoice_code)}`,
  );

  // 16.4 三项自洽 → ok
  const invOk = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(1),
    amount: '100.00',
    tax_amount: '13.00',
    total_amount: '113.00',
  });
  record(
    '三项自洽记成 ok（100 + 13 = 113）',
    invOk.json?.data?.amount_check === 'ok',
    `amount_check=${invOk.json?.data?.amount_check} ${invOk.json?.data?.amount}/${invOk.json?.data?.tax_amount}/${invOk.json?.data?.total_amount}`,
  );

  // 16.5 容差正好 1 分算 ok；差 2 分算 mismatch 但**仍然入库**
  //      OCR 的 1–2 分误差是多行明细合计的行业常态，拒绝入库等于让人为机器误差返工；
  //      而"差 2 分也存"必须靠 amount_check 标出来，否则合计里混进错票没人知道。
  const invNear = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(2),
    amount: '100.00',
    tax_amount: '13.00',
    total_amount: '113.01',
  });
  record(
    '差 1 分（容差内）仍记成 ok',
    invNear.json?.data?.amount_check === 'ok',
    `amount_check=${invNear.json?.data?.amount_check} total=${invNear.json?.data?.total_amount}`,
  );
  const invOff = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(3),
    amount: '100.00',
    tax_amount: '13.00',
    total_amount: '113.02',
  });
  record(
    '差 2 分记成 mismatch 且仍然入库（不拒收）',
    invOff.status === 201 && invOff.json?.data?.amount_check === 'mismatch',
    `HTTP ${invOff.status} amount_check=${invOff.json?.data?.amount_check} total=${invOff.json?.data?.total_amount}`,
  );

  // 16.6 缺一项用「价税合计 − 税额」推导
  //      不推导的话，只拍了半张票的用户得自己算，而算错的合计数没人能发现。
  const invDerived = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(4),
    tax_amount: '13.00',
    total_amount: '113.00',
  });
  record(
    '缺不含税金额时按 total−tax 推导（derived，补出 100.00）',
    invDerived.json?.data?.amount_check === 'derived' && invDerived.json?.data?.amount === '100.00',
    `amount_check=${invDerived.json?.data?.amount_check} amount=${invDerived.json?.data?.amount}`,
  );

  // 16.7 空就是空，不能写成 0
  //      用 '0.00' 冒充"没认出来"，会让合计少算却不报警 —— 而合计正是对账凭据。
  const invBlank = await invCreate({ invoice_code: '111100001111', invoice_no: invNo(5), total_amount: '50.00' });
  record(
    '没填的两项读回 null（不能是 0.00）',
    invBlank.json?.data?.amount === null && invBlank.json?.data?.tax_amount === null,
    `amount=${JSON.stringify(invBlank.json?.data?.amount)} tax=${JSON.stringify(invBlank.json?.data?.tax_amount)}`,
  );

  // 16.8 numeric(14,2) 的尾零不能掉
  //      SELECT 里一旦转了 float（或 ORM 当 number 返回），'1900.10' 会变成 '1900.1'，
  //      对账时"这一分钱差在哪"能查半天，而且看起来像人录错了。
  const invScale = await invCreate({ invoice_code: '111100001111', invoice_no: invNo(6), amount: '1900.10' });
  record(
    '金额尾零不丢（读回 1900.10，是字符串不是数字）',
    invScale.json?.data?.amount === '1900.10' && typeof invScale.json?.data?.amount === 'string',
    `amount=${JSON.stringify(invScale.json?.data?.amount)}（${typeof invScale.json?.data?.amount}）`,
  );

  // 16.9 红字票：填正数也要归一成负数，而**状态仍是「正常」**
  //      红字票是一张正常凭证，"红"说的是票面性质（金额为负），不是"被冲掉了"。
  //      漏了这一步，红字票在合计里等于一张正常票，账面上凭空多出一笔钱。
  const invRed = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(7),
    is_red_letter: true,
    original_invoice_no: invNo(1),
    amount: '100.00',
    tax_amount: '13.00',
    total_amount: '113.00',
  });
  const invRedId = invRed.json?.data?.id;
  record(
    '红字票填正数被归一成三项负数，状态仍是「正常」（票面性质 ≠ 已冲红）',
    invRed.json?.data?.amount === '-100.00' &&
      invRed.json?.data?.tax_amount === '-13.00' &&
      invRed.json?.data?.total_amount === '-113.00' &&
      invRed.json?.data?.status === 'normal' &&
      invRed.json?.data?.is_red_letter === true &&
      invRed.json?.data?.original_invoice_no === invNo(1),
    `${invRed.json?.data?.amount} / ${invRed.json?.data?.total_amount} status=${invRed.json?.data?.status} red=${invRed.json?.data?.is_red_letter}`,
  );

  // 16.9b 红字票不能再标「已冲红」（0.1.42 客户要求）
  //       红字票自己就是那张冲减凭证；再给它盖「已冲红」，等于说"它被另一张票冲了"，
  //       一对票也就抵不出 0 了。界面在红字票上已经不给这个按钮，服务端同样要拒。
  const invRedToRed = await call('PATCH', `/invoices/${invRedId}/status`, {
    as: 'admin',
    body: { status: 'red' },
  });
  const invRedAfterReject = await call('GET', `/invoices/${invRedId}`, { as: 'admin' });
  record(
    '红字票标「已冲红」被拒（409 / 40901），且状态与金额都不动',
    invRedToRed.status === 409 &&
      invRedToRed.json?.code === 40901 &&
      invRedAfterReject.json?.data?.status === 'normal' &&
      invRedAfterReject.json?.data?.is_red_letter === true &&
      invRedAfterReject.json?.data?.total_amount === '-113.00',
    `${invRedToRed.status} ${invRedToRed.json?.code}；之后 status=${invRedAfterReject.json?.data?.status} total=${invRedAfterReject.json?.data?.total_amount}`,
  );

  // 16.10 标「已冲红」只改标签，**不动金额**
  //       抵账的负数由红字票自己带着；这里要是顺手翻符号，一对票会被抵两次。
  //       造一张蓝票来标，这样断言里"金额没变"才有意义。
  const invBlueForStatus = await invCreate({
    invoice_code: '111100001111',
    invoice_no: invNo(8),
    amount: '100.00',
    tax_amount: '13.00',
    total_amount: '113.00',
  });
  const invBlueForStatusId = invBlueForStatus.json?.data?.id;
  const invToRed = await call('PATCH', `/invoices/${invBlueForStatusId}/status`, {
    as: 'admin',
    body: { status: 'red' },
  });
  record(
    '标「已冲红」金额一分不动，且 status_source 记成 manual',
    invToRed.json?.data?.status === 'red' &&
      invToRed.json?.data?.amount === '100.00' &&
      invToRed.json?.data?.total_amount === '113.00' &&
      invToRed.json?.data?.status_source === 'manual',
    `${invToRed.json?.data?.status} ${invToRed.json?.data?.total_amount} source=${invToRed.json?.data?.status_source}`,
  );

  // 16.10b 把「已冲红」的票勾成红字票：那个标签必须同时撤掉（0.1.42）
  //        两者互斥。留在 red 上就会得到"红字票被标已冲红"的行——
  //        状态栏和金额自相矛盾，而合计只能对一次。
  const invFlip = await call('PATCH', `/invoices/${invBlueForStatusId}`, {
    as: 'admin',
    body: { is_red_letter: true },
  });
  record(
    '勾上红字票时「已冲红」自动撤回，金额按票面性质翻成负数',
    invFlip.json?.data?.is_red_letter === true &&
      invFlip.json?.data?.status === 'normal' &&
      invFlip.json?.data?.total_amount === '-113.00',
    `red=${invFlip.json?.data?.is_red_letter} status=${invFlip.json?.data?.status} total=${invFlip.json?.data?.total_amount}`,
  );
  // 复原成蓝票 + 已冲红，后面 16.12/16.14 的合计与筛选仍按这张票的原样算
  await call('PATCH', `/invoices/${invBlueForStatusId}`, {
    as: 'admin',
    body: { is_red_letter: false, status: 'red' },
  });

  // 16.12 summary 与 items 必须是同一个口径
  //       两条 SQL 各写一遍就会出现"合计和行数对不上"，而这种不一致没人能复现，
  //       只会被当成"这套系统不可信"。这里拿自己造的这批票逐项对上。
  const invListUrl = `/invoices?buyer=${encodeURIComponent(invBuyer)}&limit=100`;
  const invList = await call('GET', invListUrl, { as: 'admin' });
  const invRows = invList.json?.data?.items ?? [];
  const invSummary = invList.json?.data?.summary ?? {};
  const invAllCount = invList.json?.data?.total ?? -1;
  const invSumTotal = sumCents(invRows.map((r) => r.total_amount));
  const invMissing = invRows.filter((r) => r.amount === null || r.tax_amount === null || r.total_amount === null).length;
  record(
    'summary.count = total（同一次扫描，不是两条 SQL）',
    invSummary.count === invAllCount && invAllCount > 0,
    `summary.count=${invSummary.count} total=${invAllCount}`,
  );
  record(
    'summary.sum_total_amount = items 逐条定点累加',
    centsOf(invSummary.sum_total_amount) === invSumTotal,
    `summary=${invSummary.sum_total_amount} 累加=${fmtCents(invSumTotal)}（${invRows.length} 行）`,
  );
  record(
    'summary.missing_amount_count = 三列有任一为 null 的行数',
    invSummary.missing_amount_count === invMissing,
    `summary=${invSummary.missing_amount_count} 实际=${invMissing}`,
  );

  // 16.13 模糊查询命中中间一段字 + 日期边界含当天
  //       日期条件写成 `>` / `<` 就会漏掉当天的票，而"当天开的票查不到"是最容易被投诉的一种。
  const invFuzzy = await call('GET', `/invoices?buyer=${encodeURIComponent(`购买方${invStamp}中间`)}&limit=100`, {
    as: 'admin',
  });
  const invDateIn = await call(
    'GET',
    `/invoices?buyer=${encodeURIComponent(invBuyer)}&issued_from=${invToday}&issued_to=${invToday}&limit=100`,
    { as: 'admin' },
  );
  const invDateOut = await call(
    'GET',
    `/invoices?buyer=${encodeURIComponent(invBuyer)}&issued_from=2000-01-01&issued_to=${invYesterday}&limit=100`,
    { as: 'admin' },
  );
  record(
    '购买方模糊查只给中间一段字也能命中',
    (invFuzzy.json?.data?.total ?? -1) === invAllCount,
    `模糊命中 ${invFuzzy.json?.data?.total ?? '?'} / 全量 ${invAllCount}`,
  );
  record(
    '开票日期区间含边界当天（且不含区间外）',
    (invDateIn.json?.data?.total ?? -1) === invAllCount && (invDateOut.json?.data?.total ?? -1) === 0,
    `当天区间 ${invDateIn.json?.data?.total ?? '?'} 条 / 截止昨天 ${invDateOut.json?.data?.total ?? '?'} 条`,
  );

  // 16.13b 状态筛选三选一，互斥且加起来是全集（0.1.42）
  //        「正常」里混进红字票，是列表上最容易被指出来的矛盾：那一行的状态栏
  //        明明写着「红字票」。所以 normal 必须排除 is_red_letter。
  const invByNormal = await call(
    'GET',
    `/invoices?buyer=${encodeURIComponent(invBuyer)}&status=normal&limit=100`,
    { as: 'admin' },
  );
  const invByRed = await call('GET', `/invoices?buyer=${encodeURIComponent(invBuyer)}&status=red&limit=100`, {
    as: 'admin',
  });
  const invByRedLetter = await call(
    'GET',
    `/invoices?buyer=${encodeURIComponent(invBuyer)}&status=red_letter&limit=100`,
    { as: 'admin' },
  );
  const invNormalHasRed = (invByNormal.json?.data?.items ?? []).some((r) => r.is_red_letter);
  record(
    '状态筛选互斥：正常不含红字票，红字票只给红字票，三项相加等于全量',
    invNormalHasRed === false &&
      (invByRedLetter.json?.data?.total ?? -1) === 1 &&
      (invByRedLetter.json?.data?.items ?? []).every((r) => r.is_red_letter) &&
      (invByRed.json?.data?.total ?? -1) === 1 &&
      (invByNormal.json?.data?.total ?? -1) + (invByRed.json?.data?.total ?? -1) +
        (invByRedLetter.json?.data?.total ?? -1) === invAllCount,
    `normal=${invByNormal.json?.data?.total} red=${invByRed.json?.data?.total} red_letter=${invByRedLetter.json?.data?.total} 全量=${invAllCount}`,
  );

  // 16.11 权限：改状态与删除都只有管理员
  //       冲红会翻转金额符号、删除会让票从台账消失，这两件事不能让当天录票的人顺手做。
  const invMemberStatus = await call('PATCH', `/invoices/${invRedId}/status`, {
    as: 'member',
    body: { status: 'red' },
  });
  const invMemberDel = await call('DELETE', `/invoices/${invRedId}`, { as: 'member' });
  const invAdminDel = await call('DELETE', `/invoices/${invRedId}`, { as: 'admin' });
  record('member 改不了发票状态（40301）', invMemberStatus.json?.code === 40301, `${invMemberStatus.json?.code} ${invMemberStatus.json?.message ?? ''}`);
  record('member 删不了发票（40301）', invMemberDel.json?.code === 40301, `${invMemberDel.json?.code} ${invMemberDel.json?.message ?? ''}`);
  record(
    'admin 能软删发票（返回 deleted 与原件数）',
    invAdminDel.json?.data?.deleted === true && typeof invAdminDel.json?.data?.file_count === 'number',
    `${invAdminDel.json?.code} deleted=${invAdminDel.json?.data?.deleted} file_count=${invAdminDel.json?.data?.file_count}`,
  );

  // 16.16 合同状态只有一条写入路径
  //       两处都收 status 的后果：抽屉保存时顺手提交，新建的默认值会把别人手工改过的状态冲掉，
  //       而界面上看不出任何异常（"我明明选了已结算，保存后还是签订中"）。
  const invContract = await call('POST', '/contracts', {
    as: 'admin',
    body: { title: `自检合同${invStamp}`, company_name: `自检公司${invStamp}`, category: 'commercial' },
  });
  const invContractId = invContract.json?.data?.id;
  record(
    '新建合同默认状态是 negotiating',
    invContract.json?.data?.status === 'negotiating',
    `status=${invContract.json?.data?.status ?? invContract.json?.message ?? ''}`,
  );
  const invContractPatch = await call('PATCH', `/contracts/${invContractId}`, {
    as: 'admin',
    body: { title: `自检合同${invStamp}改名`, status: 'settled' },
  });
  record(
    'PATCH /contracts/:id 收不到 status（只改到标题）',
    invContractPatch.json?.data?.status === 'negotiating' &&
      invContractPatch.json?.data?.title === `自检合同${invStamp}改名`,
    `status=${invContractPatch.json?.data?.status} title=${invContractPatch.json?.data?.title}`,
  );
  const invStatusPath = await call('PATCH', `/contracts/${invContractId}/status`, { as: 'admin', body: { status: 'settled' } });
  record(
    '只有 /contracts/:id/status 能改状态',
    invStatusPath.json?.data?.status === 'settled',
    `${invStatusPath.json?.code} status=${invStatusPath.json?.data?.status ?? invStatusPath.json?.message ?? ''}`,
  );
  const invStatuses = ['negotiating', 'performing', 'settling', 'settled', 'terminated'];
  const invCycle = [];
  for (const sv of invStatuses) {
    const one = await call('PATCH', `/contracts/${invContractId}/status`, { as: 'admin', body: { status: sv } });
    invCycle.push(`${sv}=${one.json?.data?.status ?? one.json?.code}`);
  }
  record(
    '合同五态能来回切换（不设状态机，业务方要求）',
    invCycle.every((x) => {
      const [want, got] = x.split('=');
      return want === got;
    }),
    invCycle.join(' '),
  );
  const invBadStatus = await call('PATCH', `/contracts/${invContractId}/status`, { as: 'admin', body: { status: 'bogus' } });
  record(
    '非法合同状态 400 / 40001（不静默回落）',
    invBadStatus.status === 400 && invBadStatus.json?.code === 40001,
    `${invBadStatus.status} ${invBadStatus.json?.code} ${invBadStatus.json?.message ?? ''}`,
  );

  // 16.16b 合同终止日期：填了就是周期性合同，快到期要进工作台
  //       三条一起看才说明口径没走岔：存得进去、日期反了拦得住、筛选与工作台是同一批合同。
  const endSoon = localDate(new Date(Date.now() + 10 * 864e5));
  const endFar = localDate(new Date(Date.now() + 200 * 864e5));
  const invEndContract = await call('POST', '/contracts', {
    as: 'admin',
    body: {
      title: `自检到期合同${invStamp}`,
      company_name: `自检公司${invStamp}`,
      signed_on: invToday,
      end_on: endSoon,
      category: 'lease',
    },
  });
  const invEndContractId = invEndContract.json?.data?.id;
  record(
    '合同终止日期能存能取（date 原样、不跨时区）',
    invEndContract.json?.data?.end_on === endSoon && invEndContract.json?.data?.signed_on === invToday,
    `end_on=${invEndContract.json?.data?.end_on} signed_on=${invEndContract.json?.data?.signed_on}`,
  );

  const invEndFar = await call('POST', '/contracts', {
    as: 'admin',
    body: {
      title: `自检远期合同${invStamp}`,
      company_name: `自检公司${invStamp}`,
      signed_on: invToday,
      end_on: endFar,
    },
  });
  const invEndFarId = invEndFar.json?.data?.id;

  const invEndBad = await call('POST', '/contracts', {
    as: 'admin',
    body: {
      title: `自检日期反了${invStamp}`,
      company_name: `自检公司${invStamp}`,
      signed_on: invToday,
      end_on: invYesterday,
    },
  });
  record(
    '终止日期早于签订日期 → 400（不静默纠正）',
    invEndBad.status === 400 && invEndBad.json?.code === 40001,
    `${invEndBad.status} ${invEndBad.json?.code} ${invEndBad.json?.message ?? ''}`,
  );

  const invExpiring = await call('GET', '/contracts?expiring=1&limit=100', { as: 'admin' });
  const invExpiringIds = (invExpiring.json?.data?.items ?? []).map((c) => c.id);
  record(
    '?expiring=1 只出「一个月内到期」的那份（远期的不算）',
    invExpiringIds.includes(invEndContractId) && !invExpiringIds.includes(invEndFarId),
    `命中 ${invExpiringIds.length} 份，近端=${invExpiringIds.includes(invEndContractId)} 远期=${invExpiringIds.includes(invEndFarId)}`,
  );

  /*
   * 16.16c 列表顺序（2026-11-17 客户要求）：快到期的排最前，有终止日期的排在没终止日期的前面。
   *
   * 排序在 SQL 里，单测够不着，只能在真库上验。三项分别锁住三段：
   *   ① 一个月内的排在远期前面 ② 有终止日期的排在没终止日期前面 ③ 已终止的不顶到前面
   * 只测 ① 的话，把排序写成"有终止日期的一律按签订时间"也能过，
   * 而那会让「2027-06 到期」的合同压在「下周到期」的前面——正是客户要修的那件事。
   */
  const invNoEnd = await call('POST', '/contracts', {
    as: 'admin',
    body: { title: `自检无终止日期${invStamp}`, company_name: `自检公司${invStamp}`, signed_on: invToday },
  });
  const invNoEndId = invNoEnd.json?.data?.id;
  const invTerm = await call('POST', '/contracts', {
    as: 'admin',
    body: {
      title: `自检已终止${invStamp}`,
      company_name: `自检公司${invStamp}`,
      signed_on: invToday,
      end_on: endSoon,
    },
  });
  const invTermId = invTerm.json?.data?.id;
  if (invTermId) {
    await call('PATCH', `/contracts/${invTermId}/status`, { as: 'admin', body: { status: 'terminated' } });
  }

  const invOrdered = await call('GET', '/contracts?limit=200', { as: 'admin' });
  const orderIds = (invOrdered.json?.data?.items ?? []).map((c) => c.id);
  const at = (id) => orderIds.indexOf(id);
  const posNear = at(invEndContractId);
  const posFar = at(invEndFarId);
  const posNoEnd = at(invNoEndId);
  const posTerm = at(invTermId);

  record(
    '默认列表：一个月内到期的排在远期前面',
    posNear >= 0 && posFar >= 0 && posNear < posFar,
    `近端第 ${posNear + 1} 条，远期第 ${posFar + 1} 条（共 ${orderIds.length} 条）`,
  );
  record(
    '默认列表：有终止日期的排在没终止日期的前面',
    posFar >= 0 && posNoEnd >= 0 && posFar < posNoEnd,
    `远期第 ${posFar + 1} 条，无终止日期第 ${posNoEnd + 1} 条`,
  );
  record(
    '默认列表：已终止的不顶到待续签前面',
    posTerm >= 0 && posFar >= 0 && posTerm > posFar,
    `已终止第 ${posTerm + 1} 条，远期第 ${posFar + 1} 条`,
  );

  const invDash = await call('GET', '/dashboard/summary', { as: 'admin' });
  const invDashMember = await call('GET', '/dashboard/summary', { as: 'member' });
  const invExpBlock = invDash.json?.data?.expiring_contracts;
  record(
    '工作台给管理员列出到期合同（含刚造的那份），成员拿不到这一块',
    Boolean(invExpBlock) &&
      (invExpBlock?.items ?? []).some((c) => c.id === invEndContractId) &&
      invDashMember.json?.data?.expiring_contracts === undefined,
    `total=${invExpBlock?.total} member=${JSON.stringify(invDashMember.json?.data?.expiring_contracts)}`,
  );

  // 造完就删（软删，与其它自检数据一致）：这几份合同都别留在台账里
  for (const cid of [invEndContractId, invEndFarId, invEndBad.json?.data?.id, invNoEndId, invTermId]) {
    if (cid) await call('DELETE', `/contracts/${cid}`, { as: 'admin' });
  }

  // 16.15 合同挂票必须幂等
  //       不幂等的话，用户手一抖点两下，同一份合同里就会有两行一样的票，
  //       而"这份合同到底挂了几张票"从此没有答案（去重只能靠人眼）。
  const invA = invOk.json?.data?.id;
  const invB = invNear.json?.data?.id;
  const invLink1 = await call('POST', `/contracts/${invContractId}/invoices`, {
    as: 'admin',
    body: { invoice_ids: [invA, invB] },
  });
  record('合同挂票首次 linked=2', invLink1.json?.data?.linked === 2, `linked=${invLink1.json?.data?.linked} ${invLink1.json?.message ?? ''}`);
  const invLink2 = await call('POST', `/contracts/${invContractId}/invoices`, {
    as: 'admin',
    body: { invoice_ids: [invA, invB] },
  });
  const invLinked = await call('GET', `/contracts/${invContractId}/invoices`, { as: 'admin' });
  record(
    '同一批再挂一次 linked=0 且列表仍 2 条（幂等，不报错）',
    invLink2.json?.data?.linked === 0 && (invLinked.json?.data?.items ?? []).length === 2,
    `第二次 linked=${invLink2.json?.data?.linked} 列表=${(invLinked.json?.data?.items ?? []).length} 条`,
  );
  const invUnlink = await call('DELETE', `/contracts/${invContractId}/invoices/${invA}`, { as: 'admin' });
  const invAfterUnlink = await call('GET', `/contracts/${invContractId}/invoices`, { as: 'admin' });
  record(
    '解除关联后只剩 1 条（只删边，票本身不动）',
    invUnlink.json?.data?.deleted === true && (invAfterUnlink.json?.data?.items ?? []).length === 1,
    `剩 ${(invAfterUnlink.json?.data?.items ?? []).length} 条`,
  );

  // 16.14 has_contract 过滤必须与 contract_count 同口径
  //       软删的合同关联若被算成"已挂"，"还没挂合同"里就会筛出显示"已挂 1 份"的行，
  //       用户只会认为筛选坏了 —— 而这种错没有任何报错。
  await call('POST', `/contracts/${invContractId}/invoices`, { as: 'admin', body: { invoice_ids: [invA] } });
  const invHasQuery = (v) =>
    call('GET', `/invoices?buyer=${encodeURIComponent(invBuyer)}&has_contract=${v}&limit=100`, { as: 'admin' });
  // 16.11 已经软删了一张票，所以"全量"必须重新取一次：用前面那个 10 会差一张，
  // 然后这一项会以"少一条"的样子假失败，而数据其实是对的。
  const invAlive = await call('GET', invListUrl, { as: 'admin' });
  const invAliveCount = invAlive.json?.data?.total ?? -1;
  const invHas1 = await invHasQuery(1);
  const invHas0 = await invHasQuery(0);
  const invHas1Ids = (invHas1.json?.data?.items ?? []).map((x) => x.id);
  const invHas0Ids = (invHas0.json?.data?.items ?? []).map((x) => x.id);
  record(
    'has_contract=1 只出挂了合同的票',
    invHas1Ids.length === 2 && invHas1Ids.includes(invA) && invHas1Ids.includes(invB),
    `命中 ${invHas1Ids.length} 条（应为 2）`,
  );
  record(
    'has_contract=0 不出已挂的票',
    !invHas0Ids.includes(invA) && invHas0Ids.length === invAliveCount - 2,
    `命中 ${invHas0Ids.length} 条 / 存活 ${invAliveCount}（应为 ${invAliveCount - 2}）`,
  );
  const invDelContract = await call('DELETE', `/contracts/${invContractId}`, { as: 'admin' });
  const invHas1After = await invHasQuery(1);
  const invHas0After = await invHasQuery(0);
  record(
    '合同软删后该票回到 has_contract=0（JOIN 过滤了 deleted_at）',
    invDelContract.json?.data?.deleted === true &&
      (invHas1After.json?.data?.total ?? -1) === 0 &&
      (invHas0After.json?.data?.items ?? []).some((x) => x.id === invA),
    `软删后 has_contract=1 命中 ${invHas1After.json?.data?.total ?? '?'} 条 / =0 命中 ${invHas0After.json?.data?.total ?? '?'} 条`,
  );

  // 16.17 原件：补挂 → raw 内联 → 勾选下载 ZIP 里的中文条目名
  //       这条防的是"用户以为下了 3 张、实际拿到整批"，以及中文名在包里变乱码
  //       （yazl 的 bit11 UTF-8 标记没置位时，Windows 解压会看到一串问号）。
  const invPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const invFileName = `自检扫描件${invStamp}.png`;
  const invRawPost = async (path, bytes, name) => {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      Cookie: jar.admin ?? '',
    };
    let res;
    try {
      res = await fetch(BASE + '/api/v1' + path, { method: 'POST', headers, body: bytes });
    } catch (e) {
      // 服务端在读完 body 之前就返回（401/409 这类早退）时，个别情况下连接会被重置。
      // 这里把它折成一条可读的失败证据，而不是让整个自检中断在第 120 项。
      return { status: 0, json: { code: -1, message: `请求失败：${e instanceof Error ? e.message : e}` }, headers: new Headers() };
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { code: -1, message: `非 JSON 响应（${res.status}）：${text.slice(0, 120)}` };
    }
    return { status: res.status, json, headers: res.headers };
  };
  const invAttach = await invRawPost(`/invoices/${invA}/files`, invPng, invFileName);
  const invFiles = invAttach.json?.data?.files ?? [];
  const invFileId = invFiles[0]?.id;
  record(
    '给已有发票补挂原件（跳过识别，file_count 跟着变）',
    invAttach.status === 201 && invFiles.length === 1 && invAttach.json?.data?.file_count === 1,
    `HTTP ${invAttach.status} files=${invFiles.length} file_count=${invAttach.json?.data?.file_count} ${invAttach.json?.message ?? ''}`,
  );

  if (invFileId) {
    const invRawRes = await fetch(`${BASE}/api/v1/invoices/${invA}/files/${invFileId}/raw`, {
      headers: { Cookie: jar.admin ?? '' },
      redirect: 'manual',
    });
    const invStorage = invFiles[0]?.storage;
    record(
      '原件 raw 走内联（local 200 image/png，COS 则 302 预签名）',
      invStorage === 'cos'
        ? invRawRes.status === 302
        : invRawRes.status === 200 && (invRawRes.headers.get('content-type') ?? '').includes('image/png'),
      `storage=${invStorage} HTTP ${invRawRes.status} type=${invRawRes.headers.get('content-type') ?? '-'}`,
    );

    // ZIP：勾选下载只打勾中的那一张。服务端若忽略 ids，用户就会拿到整批却以为只下了 3 张——
    // 这比"下不了"糟得多（包是拿去报销的，多出来的票要一张张手工删）。
    const invZipRes = await fetch(`${BASE}/api/v1/invoices/zip?ids=${invA}`, {
      headers: { Cookie: jar.admin ?? '' },
    });
    const invZipBuf = Buffer.from(await invZipRes.arrayBuffer());
    if (invStorage === 'cos' && invZipRes.status !== 200) {
      record(
        '勾选下载的 ZIP 条目名是中文原名（UTF-8 位已置）',
        true,
        `存储为 COS，本机未验（HTTP ${invZipRes.status}）`,
      );
    } else {
      // 中央目录：EOCD(PK\x05\x06) → 条目数 + CD 偏移，逐条读 flag(bit11) 与文件名
      const invZipEntries = (buf) => {
        let eocd = -1;
        for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
          if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
          }
        }
        if (eocd < 0) return [];
        const count = buf.readUInt16LE(eocd + 10);
        let off = buf.readUInt32LE(eocd + 16);
        const out = [];
        for (let k = 0; k < count; k += 1) {
          if (buf.readUInt32LE(off) !== 0x02014b50) break;
          const flags = buf.readUInt16LE(off + 8);
          const nameLen = buf.readUInt16LE(off + 28);
          const extraLen = buf.readUInt16LE(off + 30);
          const commentLen = buf.readUInt16LE(off + 32);
          out.push({
            name: buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'),
            utf8: (flags & 0x800) !== 0,
          });
          off += 46 + nameLen + extraLen + commentLen;
        }
        return out;
      };
      const invEntries = invZipEntries(invZipBuf);
      const invHit = invEntries.find((e) => e.name === invFileName);
      record(
        '勾选下载的 ZIP 条目名是中文原名（UTF-8 位已置）',
        invZipRes.status === 200 &&
          (invZipRes.headers.get('content-type') ?? '').includes('zip') &&
          Boolean(invHit) &&
          invHit.utf8 === true &&
          invEntries.length === 1,
        `HTTP ${invZipRes.status} 条目=${invEntries.map((e) => `${e.name}${e.utf8 ? '(utf8)' : ''}`).join(',') || '无'}`,
      );
    }
  } else {
    record('原件 raw 走内联（local 200 image/png，COS 则 302 预签名）', false, '原件没挂上，后续两项无从验证');
    record('勾选下载的 ZIP 条目名是中文原名（UTF-8 位已置）', false, '同上');
  }

  // 16.18 未配识别密钥时上传要 409 并指路设置页
  //       回 400/500 或一句干巴巴的"未配置"，用户只会在上传按钮上反复重试；
  //       配了密钥就别真调 OCR（一次调用要花钱），这一项按"未验"记通过。
  const invOcr = await call('GET', '/settings/ocr', { as: 'admin' });
  const invOcrReady = invOcr.json?.data?.enabled === true && invOcr.json?.data?.secret_key_set === true;
  if (invOcrReady) {
    record('未配识别密钥时上传给 409 + 指路文案', true, '库里已配密钥，未真调 OCR（省钱）');
  } else {
    const invUpload = await invRawPost('/invoices/upload', invPng, '自检上传.png');
    const invMsg = invUpload.json?.message ?? '';
    record(
      '未配识别密钥时上传给 409 + 指路文案',
      invUpload.status === 409 && (invMsg.includes('设置') || invMsg.includes('发票识别')),
      `HTTP ${invUpload.status} ${invMsg}`,
    );
  }

  // 自检数据自己清：这一批票与这份合同只是上面这些检查的脚手架。
  // 留着的话每跑一次用户台账里就多十几行「自检购买方…」，而且它们和真票长得一模一样
  // （下面那段自检单清理是同一个道理）。发票走软删，原件与关联都不动，可恢复。
  const invToClean = await call('GET', `${invListUrl}`, { as: 'admin' });
  let invRemoved = 0;
  for (const row of invToClean.json?.data?.items ?? []) {
    const gone = await call('DELETE', `/invoices/${row.id}`, { as: 'admin' });
    if (gone.json?.code === 0) invRemoved += 1;
  }
  await call('DELETE', `/contracts/${invContractId}`, { as: 'admin' });
  const invLeft = await call('GET', `/invoices?q=${invStamp}&limit=100`, { as: 'admin' });
  record(
    '自检发票清干净（不污染台账）',
    (invLeft.json?.data?.total ?? -1) === 0,
    `删了 ${invRemoved} 张，残留 ${invLeft.json?.data?.total ?? '?'} 条`,
  );

  // 自检单跑完自己删掉：它只是用来验证「出单」这一步，留着的话每跑一次列表里就多一张
  // 「自检样例」，跑三遍用户就分不清哪张是自己的单了。（导出那几项已经读完了，删了不影响。）
  const cleanup = await call('DELETE', `/quotes/${qid}`, { as: 'admin' });
  console.log(
    cleanup.json?.code === 0
      ? `\n自检单 ${quote.json?.data?.quote_no ?? ''} 已自动删除，不用手工作废。`
      : `\n自检单 ${quote.json?.data?.quote_no ?? ''}（客户名「自检样例」）没删掉，请手工作废。`,
  );
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
