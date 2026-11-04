/**
 * Prisma CLI 配置（Prisma 7 起 datasource.url 不再写在 schema.prisma 里）。
 *
 * 两个 Prisma 7 的坑，都在这里处理：
 *   1) url 必须搬到 prisma.config.ts
 *   2) CLI 不再自动加载 .env，必须自己 loadEnvFile —— 否则报
 *      "Cannot resolve environment variable: DATABASE_URL"
 *
 * 注意：Prisma 在本项目里**只负责迁移**。数据访问走 src/server/db.ts 的 pg 连接池，
 * 原因见那个文件的注释（生成列 unit_mode 与 EXCLUDE 约束的错误码翻译）。
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL 未配置。请确认项目根目录有 .env 文件。');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // 不设 shadowDatabaseUrl：deploy 用不到影子库，设成与主库相同会直接报 P3025
  datasource: { url },
});
