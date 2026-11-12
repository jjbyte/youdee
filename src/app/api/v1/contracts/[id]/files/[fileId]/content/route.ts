import { NextResponse } from 'next/server';
import { requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { readContractFileBytes } from '@/server/services/contract-file-bytes';

/**
 * 附件的字节（同源），给前端解析器用 —— 预览 Word / Excel 时 `fetch` 这个地址。
 *
 * 为什么不直接 fetch `.../raw`：那个路由对本地文件是 302 到 `/uploads/...`，
 * 对云文件 302 到预签名地址。跟随 302 之后就是一次**跨域**请求（COS 域名），
 * 而桶的 CORS 默认没配，浏览器会拦掉，现象是"点预览一直转圈"，
 * 服务端日志一行都没有 —— 这类问题在没有服务器现场时几乎查不出来。
 *
 * 前端解析本来就需要完整字节（docx-preview / exceljs 都要整份），
 * 所以这里不做 Range、不流式，直接把内存里的 Buffer 吐出去。
 */
export const GET = route(async (_req, params) => {
  await requireUser();
  const contractId = reqUuid(params.id, 'id');
  const fileId = reqUuid(params.fileId, 'fileId');
  const { ref, buf } = await readContractFileBytes(contractId, fileId);

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': ref.mime,
      'Content-Length': String(buf.byteLength),
      // 文件名是 UUID，内容不会变；但这是内部资料，只许私有缓存
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // 这个路由只服务于"在页面里看"，不给另存为用；下载走 raw
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(ref.originalName)}`,
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
