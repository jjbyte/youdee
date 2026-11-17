import { NextResponse } from 'next/server';
import { requireInvoiceAccess, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { readInvoiceFileBytes } from '@/server/services/invoice-file.service';

/**
 * 原件的字节（同源），给页面里的预览用。
 *
 * 为什么 PDF 预览不走 `.../raw`：那个路由对云文件是 302 到预签名地址，能不能内联
 * 取决于预签名参数有没有被中间层（自定义域名 / CDN）保留下来；桶里对象元数据写的是
 * attachment，参数一丢浏览器就存盘——现象正是"点预览，反而下载了一个文件"。
 * 这条路由由服务端自己写 `Content-Type` 与 `inline`，不依赖任何存储侧配置；
 * 本地存储与云存储两种位置都从这里出字节，预览行为不会再因存放位置而不同。
 *
 * 下载仍走 `raw`（Content-Disposition 由它按扩展名决定）。
 */
export const GET = route(async (_req, params) => {
  const actor = await requireInvoiceAccess();
  const invoiceId = reqUuid(params.id, 'id');
  const fileId = reqUuid(params.fileId, 'fileId');
  const { ref, buf } = await readInvoiceFileBytes(invoiceId, fileId, {
    includeDeleted: actor.role === 'admin',
  });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': ref.mime,
      'Content-Length': String(buf.byteLength),
      // 文件名是 UUID、内容不会变；但这是财务凭据，只许私有缓存
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // 这条路由只服务于"在页面里看"；另存为走 raw
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(ref.originalName)}`,
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
