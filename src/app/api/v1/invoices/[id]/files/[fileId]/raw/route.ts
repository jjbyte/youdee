import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { getInvoiceFileRef, openInvoiceFileStream } from '@/server/services/invoice-file.service';
import { presignCosDownload } from '@/server/services/storage.service';

/**
 * 发票原件：PDF / JPG / PNG 内联预览。
 *
 * 两种存放位置两种取法：
 *   - `local`：由本路由把字节**流式**吐出（同源、带 Cookie，前端 `<img>`/`<iframe>` 直接用）。
 *     不 302 到 `/uploads` 是为了统一走一次权限检查——原件里有购买方税号与金额。
 *   - `cos`：302 到 5 分钟有效的预签名地址。桶保持私有读，链接泄露也基本没用；
 *     不把云文件流经服务端，是因为 20MB 的代理下载会把出口带宽变成瓶颈。
 *
 * `Content-Disposition` 一律 inline（发票就是给人看的），并带
 * `X-Content-Type-Options: nosniff`：原件由用户上传，禁止浏览器猜类型。
 */
const INLINE_EXT = new Set(['pdf', 'jpg', 'png']);

export const GET = route(async (_req, params) => {
  const actor = await requireUser();
  const invoiceId = reqUuid(params.id, 'id');
  const fileId = reqUuid(params.fileId, 'fileId');
  const ref = await getInvoiceFileRef(invoiceId, fileId, { includeDeleted: actor.role === 'admin' });

  const inline = INLINE_EXT.has(ref.ext);
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(ref.originalName)}`;

  if (ref.storage === 'cos') {
    const signed = await presignCosDownload({
      key: ref.storageKey,
      attachment: !inline,
      fileName: ref.originalName,
      contentType: ref.mime,
    });
    return NextResponse.redirect(signed, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const stream = await openInvoiceFileStream(ref);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': ref.mime,
      'Content-Disposition': disposition,
      'Content-Length': String(ref.sizeBytes),
      // 私有凭据：不进任何共享缓存
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
