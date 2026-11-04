/**
 * 等数据库可连接。
 *
 * docker compose 的 depends_on: service_healthy 已经等过一轮 pg_isready，
 * 但那是从**宿主机视角**探的；容器网络刚起来时应用侧第一次 TCP 仍可能被拒。
 * 更常见的坑是：db 容器 healthy 了，但 PG 还在做崩溃恢复、只接受本地连接，
 * 此时 migrate 会以 "the database system is starting up" 失败并让整个容器退出。
 * 所以这里再等一次，用应用自己的连接串——探的就是待会儿真的要用的那条路。
 */
import { Client } from 'pg';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.DATABASE_URL;

let where = '（连接串无法解析）';
try {
  const u = new URL(url);
  where = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch {
  /* 交给下面的连接报错 */
}

const DEADLINE_MS = 120_000;
const started = Date.now();
let attempt = 0;

for (;;) {
  attempt += 1;
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.end();
    console.log(`[wait-db] 已连接 ${where}（第 ${attempt} 次尝试）`);
    process.exit(0);
  } catch (e) {
    await c.end().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    if (Date.now() - started > DEADLINE_MS) {
      console.error(`[wait-db] 120 秒内连不上 ${where}，最后一次错误：${msg}`);
      process.exit(1);
    }
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`[wait-db] 尚未就绪（第 ${attempt} 次）：${msg}`);
    }
    await delay(2000);
  }
}
