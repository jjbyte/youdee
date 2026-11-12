import { body, ok, optStr, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { getStorageSettings, saveStorageSettings } from '@/server/services/storage.service';

/**
 * 对象存储配置（腾讯云 COS）。
 *
 * 只给管理员：这里是云账号的 API 密钥，泄露等于把桶的读写权交出去。
 * SecretKey 读接口**永远不回传**（只给"配没配 + 末四位"），
 * 所以前端 PATCH 时留空 = 不改，要换才填新值。
 */
export const GET = route(async () => {
  await requireAdmin('查看对象存储设置');
  return ok(await getStorageSettings());
});

export const PATCH = route(async (req) => {
  const actor = await requireAdmin('修改对象存储设置');
  const b = await body<Record<string, unknown>>(req);
  const updated = await saveStorageSettings(
    {
      enabled: b.enabled === undefined ? undefined : b.enabled === true,
      secret_id: b.secret_id === undefined ? undefined : String(b.secret_id).trim(),
      // 三态：没传 = 不改；空串 = 清空；有值 = 换新密钥
      secret_key: b.secret_key === undefined ? undefined : String(b.secret_key ?? '').trim(),
      bucket: b.bucket === undefined ? undefined : String(b.bucket).trim(),
      region: b.region === undefined ? undefined : String(b.region).trim(),
      key_prefix: b.key_prefix === undefined ? undefined : String(b.key_prefix).trim(),
      custom_domain: b.custom_domain === undefined ? undefined : optStr(b.custom_domain, 200),
    },
    actor,
  );
  return ok(updated);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
