import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { buildSampleWorkbook } from '@/server/services/template-file.service';
import { contentDisposition } from '@/server/services/export.service';

/**
 * 下载样例模板：管理员在 Excel 里改完再传回来。
 *
 * 只给管理员——这个文件决定客户版长什么样，成员不需要也不该改。
 */
export const GET = route(async () => {
  await requireAdmin('下载模板样例');
  const buf = await buildSampleWorkbook();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition('报价单模板-样例.xlsx'),
      'Cache-Control': 'no-store',
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
