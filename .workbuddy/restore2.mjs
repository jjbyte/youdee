// 把 FIX 用例改动的种子字段还原（moq 回 null，source_note 回种子里那句）
const BASE = 'http://127.0.0.1:3010/api/v1';
const PWD = 'youdee2026';
const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login: 'admin', password: PWD }),
});
const ck = login.headers.getSetCookie().find((c) => c.startsWith('rc_session=')).split(';')[0];
const r = await fetch(`${BASE}/prices/776be9a0-5510-4e3d-980a-26fd447b1a89`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', cookie: ck },
  body: JSON.stringify({ moq: null, source_note: '旧架翻新，仅算材料与人工' }),
});
const j = await r.json();
console.log('还原 ->', r.status, JSON.stringify({ moq: j.data?.moq, source_note: j.data?.source_note }));
