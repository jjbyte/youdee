import { NextResponse } from 'next/server';
import { enumParam } from '@/server/params';
import { boolParam, requireExportInternal, requireUser, reqUuid, searchParams } from '@/server/http';
import { route } from '@/server/wrap';
import { contentDisposition, exportQuoteXlsx } from '@/server/services/export.service';
import { SHEET_OPTIONS_DEFAULT, type SheetOptions } from '@/domain/customer-sheet';

/**
 * 导出 Excel。客户版任何登录用户可导；内部版只有 admin（40302）。
 * 客户版物理上不含成本列，导出前还有一次敏感词自检，命中就中止而不是发出去。
 *
 * 客户版接收预览页那四个版式参数（layout / grouped / unit_price / discount），
 * 走的是与打印同一份 `buildCustomerSheet`——客户原话「打印出来的页面要跟 EXCEL 保持一致」，
 * 靠"两边都照着文档写一遍"是做不到的，只有同一个模型才做得到。
 */
export const GET = route(async (req, params) => {
  const sp = searchParams(req);
  const view = enumParam(sp, 'view', ['customer', 'internal'] as const) ?? 'customer';
  if (view === 'internal') await requireExportInternal();
  else await requireUser();

  const sheet: SheetOptions = {
    ...SHEET_OPTIONS_DEFAULT,
    layout: enumParam(sp, 'layout', ['detailed', 'brief'] as const) ?? SHEET_OPTIONS_DEFAULT.layout,
    grouped: boolParam(sp, 'grouped') ?? SHEET_OPTIONS_DEFAULT.grouped,
    showUnitPrice: boolParam(sp, 'unit_price') ?? SHEET_OPTIONS_DEFAULT.showUnitPrice,
    showDiscount: boolParam(sp, 'discount') ?? SHEET_OPTIONS_DEFAULT.showDiscount,
  };

  const { buffer, filename } = await exportQuoteXlsx(reqUuid(params.id, 'id'), view, sheet);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
});
