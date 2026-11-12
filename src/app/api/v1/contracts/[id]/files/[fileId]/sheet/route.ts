import { AppError, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { readContractFileBytes } from '@/server/services/contract-file-bytes';
import { previewWorkbook } from '@/server/services/sheet-preview';

/**
 * Excel 附件的表格预览（返回二维字符串，前端画 <table>）。
 *
 * 为什么要一个专门的接口，而不是把 xlsx 原文件发给前端用 SheetJS 解析：
 *   1. 项目已有 exceljs（导出在用），不必为预览再引一个解析库；
 *   2. 解析不受信任的 xlsx（本质是 zip + XML）有压缩炸弹和原型污染风险，
 *      留在服务端至少能被内存/超时兜住，丢给浏览器就是用户的机器在扛；
 *   3. 前端拿到的是几十 KB 的 JSON，比灌 20MB 的二进制进弹层快得多。
 *
 * 只支持 .xlsx。老版 .xls 是二进制 BIFF 格式，exceljs 读不了 ——
 * 与其解析失败给一句"格式错误"，不如直接说清楚怎么办。
 */
export const GET = route(async (_req, params) => {
  await requireUser();
  const contractId = reqUuid(params.id, 'id');
  const fileId = reqUuid(params.fileId, 'fileId');
  const { ref, buf } = await readContractFileBytes(contractId, fileId);

  if (ref.ext === 'xls') {
    throw new AppError(
      41502,
      '老版 .xls 无法在线预览。下载后用 Excel 打开、另存为 .xlsx 再上传，就能在这里直接看了。',
      415,
    );
  }
  if (ref.ext !== 'xlsx') {
    throw new AppError(41502, `这份附件是 ${ref.ext.toUpperCase() || '未知格式'}，不是表格。`, 415);
  }

  let sheets;
  try {
    sheets = await previewWorkbook(buf);
  } catch {
    // exceljs 解析失败的原因很多（文件损坏、加密、带密码保护），
    // 对用户来说处理方式只有一个：下载下来用 Excel 打开看看
    throw new AppError(41503, '这份 Excel 解析不了（可能损坏、加密或带密码保护）。请下载后用 Excel 打开。', 415);
  }

  if (sheets.length === 0) {
    throw new AppError(42201, '这份 Excel 里没有可显示的内容。', 422);
  }

  return ok({ sheets });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
