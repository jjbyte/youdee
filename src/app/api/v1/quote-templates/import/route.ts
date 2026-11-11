import { AppError, ok, optStr, requireAdmin } from '@/server/http';
import { route } from '@/server/wrap';
import { parseTemplateSheet } from '@/domain/template-layout';
import { assertXlsx, readTemplateSheet } from '@/server/services/template-file.service';
import { saveBuffer } from '@/server/services/upload.service';
import { createTemplate, patchTemplate } from '@/server/services/templates.service';

/**
 * 导入 Excel 版式。
 *
 * 两种用法：不带 template_id = 新建模板；带 = 给已有模板换版式（改完再传一次）。
 * 解析不通过时**不落任何东西**——宁可让人改 Excel，也不留一个半成品模板
 * 在新建单的下拉里等着被选中。
 */
export const POST = route(async (req) => {
  const actor = await requireAdmin('导入报价单模板');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new AppError(40001, '请选择要上传的 xlsx 文件。', 400, { field: 'file' });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) throw new AppError(40001, '上传的文件是空的。', 400, { field: 'file' });
  if (buf.byteLength > 5 * 1024 * 1024) {
    throw new AppError(41301, '文件超过 5MB。模板里通常不该放图片，把图片删掉再传。', 413, { field: 'file' });
  }

  assertXlsx(buf);
  const raw = await readTemplateSheet(buf);
  const { layout, issues } = parseTemplateSheet(raw);
  const errors = issues.filter((i) => i.level === 'error');
  if (!layout) {
    throw new AppError(
      42201,
      `这个模板有 ${errors.length} 处问题，改完再传。第一条：${errors[0]?.where ?? ''} ${errors[0]?.message ?? ''}`.trim(),
      422,
      { field: 'file', detail: { issues } },
    );
  }

  const nameRaw = optStr(form?.get('name'), 60);
  const supplier = optStr(form?.get('supplier_name'), 120);
  const templateId = optStr(form?.get('template_id'), 64);
  const isDefault = String(form?.get('is_default') ?? '') === 'true';
  const saved = await saveBuffer(buf, 'templates', 'xlsx');

  if (templateId) {
    const t = await patchTemplate(
      templateId,
      {
        ...(nameRaw ? { name: nameRaw } : {}),
        ...(supplier !== null ? { supplier_name: supplier } : {}),
        layout,
        source_file: saved.storageKey,
        ...(isDefault ? { is_default: true } : {}),
      },
      actor,
    );
    return ok({ template: t, issues }, 200);
  }

  // 没给名字就用文件名去掉扩展名，省一步输入；重名会被 assertNameFree 拦下并提示改名
  const fallbackName = (file.name || 'Excel 模板').replace(/\.xlsx$/i, '').slice(0, 60) || 'Excel 模板';
  const t = await createTemplate(
    {
      name: nameRaw ?? fallbackName,
      supplier_name: supplier ?? '',
      layout,
      source_file: saved.storageKey,
      is_default: isDefault,
    },
    actor,
  );
  return ok({ template: t, issues }, 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
