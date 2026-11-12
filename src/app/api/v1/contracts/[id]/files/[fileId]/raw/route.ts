import { NextResponse } from 'next/server';
import { requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { getContractFileRef } from '@/server/services/contract.service';
import { presignCosDownload } from '@/server/services/storage.service';

/**
 * 附件的对外的"可点链接"：本地文件直接跳 `/uploads/...`，
 * 云存储文件 302 到预签名地址。
 *
 * 为什么不让前端直接拿 COS 直链：
 *   1. 桶是私有的，直链需要签名；把签名烘进库里的 URL = 永久有效的公有链接
 *      （会出现在浏览器历史、转发消息、截图里），泄露一次就没法收回。
 *   2. 签名地址 5 分钟过期，过期后这个路由再签一次就行，不需要人管。
 *
 * 为什么不把云文件流经服务端：附件已经不限大小，代理下载等于把出口带宽
 * 和内存都变成瓶颈。302 之后浏览器直连 COS，服务端只出一行头。
 */
const OFFICE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx']);

export const GET = route(async (req, params) => {
  await requireUser();
  const contractId = reqUuid(params.id, 'id');
  const fileId = reqUuid(params.fileId, 'fileId');
  const ref = await getContractFileRef(contractId, fileId);

  const ext = (ref.storageKey.split('.').pop() ?? '').toLowerCase();
  // Office 一律下载：内联只会让浏览器弹空白页，还可能触发插件旧漏洞。
  // 图片与 PDF 保持内联——点开就能看是它们全部的价值
  const attachment = OFFICE_EXT.has(ext);
  const headers = { 'Cache-Control': 'private, no-store' };

  if (ref.storage === 'local') {
    const target = /^https?:\/\//i.test(ref.url) ? ref.url : ref.url.startsWith('/') ? ref.url : `/${ref.url}`;
    return NextResponse.redirect(new URL(target, req.url), { status: 302, headers });
  }

  const signed = await presignCosDownload({
    key: ref.storageKey,
    attachment,
    fileName: ref.originalName,
    contentType: ref.mime,
  });
  return NextResponse.redirect(signed, { status: 302, headers });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
