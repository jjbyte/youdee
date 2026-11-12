import { AppError, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { addContractFile, CONTRACT_FILE_MAX_BYTES } from '@/server/services/contract.service';
import { stageUploadStream } from '@/server/services/upload-stream.service';
import { isFileCategory } from '@/server/services/file-type';

/**
 * 上传合同附件（**原始字节流**）。
 *
 * 为什么不再用 multipart/form-data：附件已经不限单份大小，而 `req.formData()`
 * 会把整份文件先读进内存再交给我们。传一个 2GB 的扫描件，进程就直接没了，
 * 而且死之前不会有任何日志。所以这里收裸 body，服务端边收边写临时盘。
 *
 * 三类附件分开放的同一个接口，`x-file-category` 决定收什么格式：
 *   contract   合同电子版   PDF / JPG / PNG / WEBP / Word
 *   quote      报价单电子版 PDF / JPG / PNG / WEBP / Excel（没有系统报价单时用）
 *   settlement 结算资料     PDF / JPG / PNG / WEBP / Excel / Word
 *
 * 请求形状（前端固定这样发）：
 *   POST /api/v1/contracts/<id>/files
 *   Content-Type: application/octet-stream
 *   X-File-Name: <encodeURIComponent(原始文件名)>
 *   X-File-Category: contract | quote | settlement
 *   body: 文件字节
 *
 * 原始文件名走 header 而不是 URL：中文名要 encodeURIComponent，
 * 放 query 里容易被二次编码，最后在库里存成 `%E5%90%88%E5%90%8C`。
 */
export const POST = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');

  const url = new URL(req.url);
  const rawCategory = req.headers.get('x-file-category') ?? url.searchParams.get('category') ?? 'contract';
  if (!isFileCategory(rawCategory)) {
    throw new AppError(40001, 'category 只能是 contract / quote / settlement。', 400, { field: 'category' });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    // 部署前缓存在浏览器里的老页面还是 multipart。明说怎么修，
    // 否则它会被读成"没有文件"，用户只会反复重试
    throw new AppError(40001, '上传方式已经换成流式上传，刷新一下页面再传一次就好。', 400, { field: 'file' });
  }

  const originalName = decodeName(req.headers.get('x-file-name') ?? url.searchParams.get('name') ?? '');
  const staged = await stageUploadStream(req.body, {
    originalName,
    maxBytes: CONTRACT_FILE_MAX_BYTES,
  });
  return ok(await addContractFile(id, staged, rawCategory), 201);
});

/** header 里只能是 ASCII，中文名前端会 encodeURIComponent，这里还原 */
function decodeName(raw: string): string {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // 编码不合法就用原样：文件名只用于展示，不该因为它让上传失败
  }
  return name.replace(/[\u0000-\u001f]/g, '').replace(/[\\/]/g, '_').slice(0, 200);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
