import { readFile } from 'node:fs/promises';
import { AppError, ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';
import { cleanupStaged, stageInvoiceRawUpload } from '@/server/services/invoice-file.service';
import { requireOcrConfig } from '@/server/services/ocr-settings.service';
import { recognizeInvoice } from '@/server/services/invoice-ocr.service';
import { persistUpload } from '@/server/services/invoice-upload.service';

/**
 * 上传发票原件 → 识别 → 入库（**原始字节流**）。
 *
 * 为什么不用 `multipart/form-data`：`req.formData()` 会把整份文件先读进内存，
 * 一张 8MB 的手机照片 × 并发 3 就是 24MB/请求的瞬时占用，而且失败路径没有日志。
 * 这里沿用 `stageUploadStream`：边收边写临时盘，判完真实类型再进识别。
 *
 * 请求形状（前端固定这样发）：
 *   POST /api/v1/invoices/upload
 *   Content-Type: application/octet-stream
 *   X-File-Name: <encodeURIComponent(原始文件名)>
 *   body: 文件字节
 *
 * 原始文件名走 header 而不是 query：中文名要 encodeURIComponent，放 query 里
 * 容易被二次编码，最后在库里存成 `%E5%8F%91%E7%A5%A8`。
 *
 * 顺序不能反（Spec §5.2/§5.4）：
 *   先查配置（没配就 409，别让人传完 20 张才发现）→ 收字节 + 判类型（在
 *   `stageInvoiceRawUpload` 里，与「补原件」入口共用同一套上限与白名单）→ OCR → 落库。
 * 任何一步失败都清临时文件：**不留半行**，半成品行会让合计出现一个没人负责的空洞。
 *
 * 未配识别密钥时不走这条路（409），改走 `POST /invoices/:id/files`：
 * 先手工录入票面，再把扫描件补挂上去（补原件不做 OCR）。
 */
export const POST = route(async (req) => {
  const actor = await requireUser();

  // ① 未配置识别就不收文件：未配置时 409 + 引导文案（与前端置灰用的是同一句话）
  await requireOcrConfig();

  // ② 收字节 + 魔数嗅探 + 类型白名单（共用入口，见 invoice-file.service）
  //
  // 三条防线都在那个函数里，这里只把参数取干净：
  //   - 大小上限 `size > 20971520`（20MB）由 stageUploadStream 的 maxBytes 拦，
  //     `content-length` 只是提前拒（可伪造、也可缺失，chunked 上传就没有）；
  //   - 真实类型用 magic bytes 嗅探（detectFileType / detectFileTypePartial），
  //     不信 Content-Type、也不信扩展名；
  //   - 白名单只收 PDF / JPG / PNG（前端 accept=.pdf,.jpg,.jpeg,.png 只是提示）。
  const body = req.body;
  if (!body || typeof body !== 'object') {
    throw new AppError(40001, '没有收到文件内容。', 400, { field: 'file' });
  }
  const staged = await stageInvoiceRawUpload({
    contentType: req.headers.get('content-type'),
    fileName: req.headers.get('x-file-name') ?? new URL(req.url).searchParams.get('name'),
    contentLength: req.headers.get('content-length'),
    body,
  });

  try {
    const bytes = await readFile(staged.tmpPath);
    const outcome = await recognizeInvoice(bytes, staged.type.mime);
    return ok(await persistUpload({ staged, outcome, actor }), 201);
  } catch (e) {
    // persistUpload 内部也会清（成功失败都清），这里兜住"识别阶段就失败"的路径；
    // discardStaged 是 force 删除，文件已不在也不报错
    await cleanupStaged(staged);
    throw e;
  }
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** OCR + 落盘在慢网络下会超过默认的函数超时，给足 60s（单张 P95 目标 6s） */
export const maxDuration = 60;
