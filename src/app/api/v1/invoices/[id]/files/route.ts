import { AppError, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { stageInvoiceRawUpload } from '@/server/services/invoice-file.service';
import { attachInvoiceFile } from '@/server/services/invoice-upload.service';
import { getInvoice } from '@/server/services/invoice.service';

/**
 * 给一张已有发票补挂原件（**原始字节流，跳过识别**）。
 *
 * 请求形状与上传接口一致（前端可以复用同一个发送函数）：
 *   POST /api/v1/invoices/:id/files
 *   Content-Type: application/octet-stream
 *   X-File-Name: <encodeURIComponent(原始文件名)>
 *   body: 文件字节
 *
 * 为什么要这一条：识别要腾讯云密钥，而录票不能等密钥审批。用户先用「手工录入」
 * 把票面数字记下来，扫描件到手后再补挂上来——台账里因此不会有"金额空、号码空"
 * 的半成品行（那会让合计出现一个没人负责的空洞）。
 *
 * 权限同编辑（登录即可，不要 admin）：补原件是行政活，卡在管理员身上会变成
 * "管理员不在就归档不了"。而它能造成的最坏后果是多一份附件，改不了任何金额。
 *
 * 体积上限 / 类型白名单与识别上传**同一个入口**（`stageInvoiceRawUpload`）：
 * 两条路进来的文件落在同一张表里，规则分叉就会出现"这边收 20MB、那边收 10MB"。
 *
 * 返回更新后的 `InvoiceDetail`：`files[]` 与 `file_count` 要立刻跟着变，
 * 否则用户挂完看到"还是 0 份"，会再传一次。
 */
export const POST = route(async (req, params) => {
  await requireUser();
  const invoiceId = reqUuid(params.id, 'id');
  // 断流当成 400 而不是 500：走到 pipeline 里就只剩"服务器开小差了"
  const body = req.body;
  if (!body || typeof body !== 'object') {
    throw new AppError(40001, '没有收到文件内容。', 400, { field: 'file' });
  }
  const staged = await stageInvoiceRawUpload({
    contentType: req.headers.get('content-type'),
    fileName: req.headers.get('x-file-name'),
    contentLength: req.headers.get('content-length'),
    body,
  });
  // 收尾（清临时文件、失败回收物理文件）都在 attachInvoiceFile 内部
  await attachInvoiceFile(invoiceId, staged);
  return ok(await getInvoice(invoiceId), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** 只落盘不识别，慢的是网络而不是 CPU；20MB 在差网络上仍要一会儿 */
export const maxDuration = 60;
