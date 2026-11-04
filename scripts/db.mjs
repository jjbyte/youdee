#!/usr/bin/env node
/**
 * 本地开发数据库管理（embedded-postgres = 真实 PostgreSQL 18.6 二进制）
 *
 * 用法：
 *   node scripts/db.mjs start    启动并保持（前台阻塞，Ctrl+C 停止）
 *   node scripts/db.mjs status   检查连通性
 *   node scripts/db.mjs stop     停止（调 pg_ctl）
 *
 * 为什么不用 Docker：开发机无 Docker。embedded-postgres 拉的是官方 PG 18.6
 * 二进制，btree_gist / EXCLUDE / daterange 全部与生产一致 —— 这是本项目
 * 最核心的数据库约束，不能用 SQLite 或 PGlite 替代。
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.PG_PORT || 55432);
const USER = process.env.PG_USER || 'postgres';
const PASSWORD = process.env.PG_PASSWORD || 'postgres';
const DB_NAME = process.env.PG_DB || 'youdee';
const DATA_DIR = path.resolve('pgdata');

const PG_CTL = path.resolve(
  'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',
);

async function canConnect() {
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch {
    try { await client.end(); } catch {}
    return false;
  }
}

async function status() {
  const up = await canConnect();
  if (up) {
    const client = new pg.Client({
      host: '127.0.0.1', port: PORT, user: USER, password: PASSWORD, database: DB_NAME,
    });
    try {
      await client.connect();
      const v = await client.query('SHOW server_version');
      const d = await client.query('SELECT current_database() AS db');
      console.log(`[db] UP  127.0.0.1:${PORT}  version=${v.rows[0].server_version}  db=${d.rows[0].db}`);
      await client.end();
    } catch (e) {
      console.log(`[db] UP (postgres) 但连不上 ${DB_NAME}: ${e.message}`);
      try { await client.end(); } catch {}
    }
  } else {
    console.log(`[db] DOWN  127.0.0.1:${PORT}`);
  }
  return up;
}

async function start() {
  if (await canConnect()) {
    console.log(`[db] 已在运行 127.0.0.1:${PORT}，无需重复启动`);
    await status();
    return;
  }

  const pgServer = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
  });

  if (!existsSync(DATA_DIR) || !existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log('[db] 初始化集群 ...');
    await pgServer.initialise();
  }

  console.log('[db] 启动 PostgreSQL ...');
  await pgServer.start();

  // 建库（已存在则忽略）
  try {
    await pgServer.createDatabase(DB_NAME);
    console.log(`[db] 创建数据库 ${DB_NAME}`);
  } catch (e) {
    if (!String(e.message).includes('already exists')) throw e;
  }

  await status();
  console.log('[db] 就绪。Ctrl+C 停止。');

  const shutdown = async (sig) => {
    console.log(`\n[db] 收到 ${sig}，正在停止 ...`);
    try { await pgServer.stop(); } catch (e) { console.error('[db] stop error', e.message); }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 保持进程存活
  setInterval(() => {}, 60_000);
}

function stop() {
  if (!existsSync(PG_CTL)) {
    console.error('[db] 找不到 pg_ctl，可能未安装 embedded-postgres');
    process.exit(1);
  }
  const r = spawnSync(PG_CTL, ['stop', '-D', DATA_DIR, '-m', 'fast'], {
    encoding: 'utf8',
  });
  console.log((r.stdout || '') + (r.stderr || ''));
  console.log(`[db] stop exit=${r.status}`);
}

const cmd = process.argv[2] || 'status';
try {
  if (cmd === 'start') await start();
  else if (cmd === 'status') await status();
  else if (cmd === 'stop') stop();
  else {
    console.error('用法: node scripts/db.mjs <start|status|stop>');
    process.exit(1);
  }
} catch (e) {
  console.error('[db] 失败:', e.message);
  process.exit(1);
}
