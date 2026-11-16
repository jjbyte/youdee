import { ok, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { invalidateOcrClient, testOcrConnection } from '@/server/services/invoice-ocr.service';

/**
 * 测试发票识别连接：用一张内置样例图**真调一次**。
 *
 * 为什么不能只校验密钥格式：子账号经常没有 OCR 权限（签名能算出来，请求 403），
 * 或者套餐已欠费。这类问题只有真调一次才会暴露，而用户会在开票旺季才发现。
 *
 * 样例是纯白图：一定识别不出票据，于是返回 42208 时
 * **说明"账号 + 权限 + 网络"三件事都通了**，按成功处理（不消耗识别成功额度）。
 * 50202（未开通 / 欠费）才是真失败，原样回给人话。
 *
 * 仅管理员：密钥就在这里，普通成员能测等于能间接验证别人配的密钥。
 */
export const POST = route(async () => {
  await requireAdmin('测试发票识别');
  // 上一次保存可能刚换了密钥，先丢缓存再测，否则测的是旧密钥
  invalidateOcrClient();
  return ok(await testOcrConnection());
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** 一次 OCR 调用，20s 超时 + 余量 */
export const maxDuration = 60;
