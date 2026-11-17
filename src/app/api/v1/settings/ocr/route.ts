import { body, ok, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { getOcrSettings, saveOcrSettings } from '@/server/services/ocr-settings.service';
import { invalidateOcrClient } from '@/server/services/invoice-ocr.service';

/**
 * 发票识别（腾讯云 OCR）设置。
 *
 * **GET 与 PATCH 都仅管理员**（2026-11-17 起）。
 * 曾经 GET 对 member 开放，理由是"上传按钮要据此置灰，不然成员传完 20 张才发现没配"；
 * 现在发票台账整块对成员关闭，成员根本走不到上传按钮，这条理由自动失效。
 * 留着反而多一个出口：密钥末四位与"配没配"也是配置信息，不该给不需要它的人。
 * 密钥值永远不出去 —— 只给"配没配 + 末四位"，与 `getStorageSettings` 同一套做法。
 *
 * **PATCH 仅管理员**：这里是云账号的 API 密钥，泄露等于替人付费识别。
 * `secret_key` 留空 = 不改（界面上必须写明这一条，否则人会以为密钥丢了）。
 */
export const GET = route(async () => {
  await requireAdmin('查看发票识别设置');
  return ok(await getOcrSettings());
});

export const PATCH = route(async (req) => {
  const actor = await requireAdmin('修改发票识别设置');
  const b = await body<Record<string, unknown>>(req);
  const saved = await saveOcrSettings(
    {
      enabled: b.enabled === undefined ? undefined : b.enabled === true,
      secret_id: b.secret_id === undefined ? undefined : String(b.secret_id).trim(),
      // 三态：没传 = 不改；空串 = 清空；有值 = 换新密钥
      secret_key: b.secret_key === undefined ? undefined : String(b.secret_key ?? '').trim(),
      region: b.region === undefined ? undefined : String(b.region).trim(),
    },
    actor,
  );
  // 密钥换了就丢掉旧客户端：SDK 把密钥吃进实例，复用旧实例等于继续用旧密钥，
  // 表现是"我已经改了密钥，怎么还报欠费"
  invalidateOcrClient();
  return ok(saved);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
