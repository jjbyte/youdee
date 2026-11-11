import { AppError, ok, requireUser, reqUuid } from '@/server/http';
import { route } from '@/server/wrap';
import { addContractFile, CONTRACT_FILE_MAX_BYTES } from '@/server/services/contract.service';
import { FILE_CATEGORY, isFileCategory } from '@/server/services/file-type';

/**
 * 上传合同附件（multipart）。
 *
 * 三类附件分开放的同一个接口，`category` 决定收什么格式：
 *   contract   合同电子版   PDF / JPG / PNG / WEBP / Word
 *   quote      报价单电子版 PDF / JPG / PNG / WEBP / Excel（没有系统报价单时用）
 *   settlement 结算资料     PDF / JPG / PNG / WEBP / Excel / Word
 *
 * 不传 category 默认 contract——老的调用方（0.1.23 的界面）仍然能传扫描件。
 */
export const POST = route(async (req, params) => {
  await requireUser();
  const id = reqUuid(params.id, 'id');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const rawCategory = form?.get('category');
  const category = rawCategory === null || rawCategory === undefined || rawCategory === '' ? 'contract' : rawCategory;
  if (!isFileCategory(category)) {
    throw new AppError(40001, 'category 只能是 contract / quote / settlement。', 400, { field: 'category' });
  }
  const rule = FILE_CATEGORY[category];
  if (!(file instanceof File)) {
    throw new AppError(40001, `请选择要上传的${rule.label}（${rule.hint}）。`, 400, { field: 'file' });
  }
  if (file.size > CONTRACT_FILE_MAX_BYTES) {
    throw new AppError(
      41301,
      `文件超过 ${CONTRACT_FILE_MAX_BYTES / 1024 / 1024}MB。压缩一下，或者拆成几份分别上传。`,
      413,
      { field: 'file' },
    );
  }
  return ok(await addContractFile(id, file, category), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
