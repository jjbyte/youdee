import { NextResponse } from 'next/server';
import { requireInvoiceAccess, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { today } from '@/server/db';
import { parseInvoiceListQuery } from '@/server/services/invoice.service';
import { buildInvoiceZip } from '@/server/services/invoice-zip.service';
import { contentDisposition } from '@/server/services/export.service';

/**
 * 批量下载（流式 ZIP）。两种模式，**都由这一个端点承担**：
 *
 *   1. 按筛选打包：参数与列表**完全一致**（`page` / `limit` 忽略）。
 *      两处共用 `parseInvoiceListQuery`，就是为了不让"界面筛出来的"和"包里装着的"
 *      变成两批票。
 *   2. 按勾选打包：`?ids=id1,id2,...`（≤500）。**此时忽略其它筛选**——
 *      勾了 5 张就必须下 5 张（见 `invoiceWhere` 的 ids 分支）。软删的仍然排除。
 *
 * 为什么不设 `Content-Length`：store 模式本可以算出来，但需要在 end() 前拿到
 * `calculatedTotalSize` 并用它决定头，收益只是"浏览器显示总大小"。
 * 代价是 Chrome 进度条显示"未知大小"——可接受（Spec §6.2）。
 *
 * 前端必须用 `window.location.href = url` 发起（GET 带 Cookie），
 * **不要 fetch→blob**：blob 会把整包读进浏览器内存，2GB 的包直接崩标签页。
 */
export const GET = route(async (req) => {
  const actor = await requireInvoiceAccess();
  const sp = searchParams(req);
  const query = parseInvoiceListQuery(sp, { allowDeleted: actor.role === 'admin' });
  // 文件名要说清这一包是什么：勾选下载时写"勾选 3 份"，用户回头能对上自己点了什么
  const fileName = query.ids ? `发票原件-勾选${query.ids.length}份.zip` : `发票原件-${today()}.zip`;
  const zip = await buildInvoiceZip(query, { fileName });

  return new NextResponse(zip.stream, {
    headers: {
      'Content-Type': 'application/zip',
      // 复用 export.service 的实现：`filename="ascii"` + `filename*=UTF-8''` 双写。
      // 只给 filename* 的话，旧浏览器/下载器会拿不到名字而落成 download.zip
      'Content-Disposition': contentDisposition(zip.fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** 500 份 / 2GB 的包在慢出口上要几分钟，给足上限 */
export const maxDuration = 300;
