import { NextResponse } from 'next/server';
import { enumParam } from '@/server/params';
import { requireExportInternal, requireUser, reqUuid, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { contentDisposition, exportQuoteXlsx } from '@/server/services/export.service';

/**
 * 导出 Excel。客户版任何登录用户可导；内部版只有 admin（40302）。
 * 客户版物理上不含成本列，导出前还有一次敏感词自检，命中就中止而不是发出去。
 */
export const GET = route(async (req, params) => {
  const sp = searchParams(req);
  const view = enumParam(sp, 'view', ['customer', 'internal'] as const) ?? 'customer';
  if (view === 'internal') await requireExportInternal();
  else await requireUser();

  const { buffer, filename } = await exportQuoteXlsx(reqUuid(params.id, 'id'), view);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
});
