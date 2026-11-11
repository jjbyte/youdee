/**
 * 报价单模板：一套固定的「供应商名称 + 抬头」配置。
 *
 * 边界：
 *   - 模板只放**每张单都一样**的东西。客户名称、项目名称、日期、有效期、报价人
 *     都是从单据或系统配置算出来的，塞进模板会让同一份模板印出两种事实。
 *   - 建单时把 supplier_name **快照**到 quotes.template_supplier_name。
 *     之后改模板不改历史单，删模板也不影响历史单重打——报价单是快照，不是视图。
 *   - 所以这里允许真删：删模板只会让 template_id 变 NULL，抬头那一行还在。
 */
import { q, tx } from '../db';
import { AppError } from '../http';
import type { CurrentUser } from '../auth/session';
import type { TemplateLayout } from '@/domain/template-layout';

export interface QuoteTemplateRow {
  id: string;
  name: string;
  supplier_name: string;
  /** Excel 解析出的版式；null = 系统默认版式 */
  layout: TemplateLayout | null;
  source_file: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface QuoteTemplateDTO {
  id: string;
  name: string;
  supplier_name: string;
  layout: TemplateLayout | null;
  source_file: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function dto(r: QuoteTemplateRow): QuoteTemplateDTO {
  return {
    id: r.id,
    name: r.name,
    supplier_name: r.supplier_name,
    layout: r.layout ?? null,
    source_file: r.source_file,
    is_default: r.is_default,
    is_active: r.is_active,
    sort_order: r.sort_order,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, name, supplier_name, layout, source_file, is_default, is_active, sort_order, created_at, updated_at`;

/**
 * 默认在前，其余按 sort_order 再按创建时间——
 * 设置页要看到全部（含停用的），新建单只要 `activeOnly`。
 */
export async function listTemplates(opts: { activeOnly?: boolean } = {}): Promise<QuoteTemplateDTO[]> {
  const rows = await q<QuoteTemplateRow>(
    `${SELECT} FROM quote_templates
      ${opts.activeOnly ? 'WHERE is_active' : ''}
      ORDER BY is_default DESC, sort_order, created_at`,
  );
  return rows.map(dto);
}

function validate(input: { name?: string; supplier_name?: string; sort_order?: number }) {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) throw new AppError(40001, '模板名称不能为空。', 400, { field: 'name' });
    if (name.length > 60) throw new AppError(40001, '模板名称最多 60 个字。', 400, { field: 'name' });
  }
  if (input.supplier_name !== undefined) {
    const s = input.supplier_name.trim();
    // 允许空：公司抬头还没定下来时也要能先把模板建出来，抬头那格显示「—」
    if (s.length > 120) throw new AppError(40001, '供应商名称最多 120 个字。', 400, { field: 'supplier_name' });
  }
  if (input.sort_order !== undefined && (!Number.isInteger(input.sort_order) || input.sort_order < 0)) {
    throw new AppError(40001, '排序号必须是不小于 0 的整数。', 400, { field: 'sort_order' });
  }
}

async function assertNameFree(name: string, exceptId: string | null): Promise<void> {
  const rows = await q<{ id: string }>(
    'SELECT id FROM quote_templates WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)',
    [name.trim(), exceptId],
  );
  if (rows.length > 0) {
    // 名字撞了不是"数据库唯一约束冲突"，是"已经有同名的模板了，换个名字或者直接用它"
    throw new AppError(40906, `已经有一个叫「${name.trim()}」的模板了，换个名字。`, 409, { field: 'name' });
  }
}

export interface CreateTemplateInput {
  name: string;
  supplier_name?: string;
  layout?: TemplateLayout | null;
  source_file?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export async function createTemplate(input: CreateTemplateInput, actor: CurrentUser): Promise<QuoteTemplateDTO> {
  validate(input);
  const name = input.name.trim();
  await assertNameFree(name, null);
  const isDefault = input.is_default === true;
  const created = await tx(async (c) => {
    if (isDefault) await c.query('UPDATE quote_templates SET is_default = false WHERE is_default');
    const r = await c.query<QuoteTemplateRow>(
      `INSERT INTO quote_templates (name, supplier_name, layout, source_file, is_default, is_active, sort_order, created_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)
       RETURNING id, name, supplier_name, layout, source_file, is_default, is_active, sort_order, created_at, updated_at`,
      [
        name,
        (input.supplier_name ?? '').trim(),
        input.layout ? JSON.stringify(input.layout) : null,
        input.source_file ?? null,
        isDefault,
        input.is_active !== false,
        input.sort_order ?? 100,
        actor.id,
      ],
    );
    return r.rows[0]!;
  });
  return dto(created);
}

export interface PatchTemplateInput {
  name?: string;
  supplier_name?: string;
  /** undefined = 不动；null = 退回系统默认版式 */
  layout?: TemplateLayout | null;
  source_file?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export async function patchTemplate(
  id: string,
  input: PatchTemplateInput,
  _actor: CurrentUser,
): Promise<QuoteTemplateDTO> {
  validate(input);
  const rows = await q<QuoteTemplateRow>(`${SELECT} FROM quote_templates WHERE id = $1`, [id]);
  const current = rows[0];
  if (!current) throw new AppError(40401, '这个模板不存在。', 404);

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (nextName !== current.name) await assertNameFree(nextName, id);

  // 停用/取消默认都要保证「至少还能建单」：全公司只剩一个启用模板时不能把它停掉
  if (input.is_active === false && current.is_active) {
    const left = await q<{ n: string }>('SELECT count(*)::text AS n FROM quote_templates WHERE is_active AND id <> $1', [id]);
    if (Number(left[0]?.n ?? 0) === 0) {
      throw new AppError(40906, '至少要保留一个启用的模板，否则新建报价单时没有模板可选。', 409);
    }
  }

  const touchLayout = input.layout !== undefined;
  const updated = await tx(async (c) => {
    if (input.is_default === true) await c.query('UPDATE quote_templates SET is_default = false WHERE id <> $1', [id]);
    // 默认模板必须同时是启用的：一个"默认但停用"的模板会让新建单直接 400
    const nextActive =
      input.is_active !== undefined ? input.is_active : input.is_default === true ? true : current.is_active;
    const r = await c.query<QuoteTemplateRow>(
      `UPDATE quote_templates
          SET name = $2,
              supplier_name = $3,
              is_default = $4,
              is_active = $5,
              sort_order = $6,
              layout = CASE WHEN $7::boolean THEN $8::jsonb ELSE layout END,
              source_file = CASE WHEN $7::boolean THEN $9 ELSE source_file END,
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, supplier_name, layout, source_file, is_default, is_active, sort_order, created_at, updated_at`,
      [
        id,
        nextName,
        input.supplier_name !== undefined ? input.supplier_name.trim() : current.supplier_name,
        input.is_default !== undefined ? input.is_default : current.is_default,
        nextActive,
        input.sort_order !== undefined ? input.sort_order : current.sort_order,
        touchLayout,
        input.layout ? JSON.stringify(input.layout) : null,
        touchLayout ? (input.source_file ?? null) : null,
      ],
    );
    return r.rows[0]!;
  });
  return dto(updated);
}

/**
 * 删除模板：**允许**。
 *
 * 与删除成员不同，这里没有台账损失——quotes.template_supplier_name 是快照，
 * template_id 只是 ON DELETE SET NULL。删掉模板，历史单重打还是当初那家供应商。
 * 只有两个硬约束：不能删默认模板（先指定别的）、不能把最后一个启用模板删掉。
 */
export async function deleteTemplate(id: string): Promise<{ deleted: true }> {
  const rows = await q<QuoteTemplateRow>(`${SELECT} FROM quote_templates WHERE id = $1`, [id]);
  const current = rows[0];
  if (!current) throw new AppError(40401, '这个模板不存在。', 404);
  if (current.is_default) {
    throw new AppError(40906, '这是默认模板，不能删。先把别的模板设为默认，再删这一个。', 409);
  }
  if (current.is_active) {
    const left = await q<{ n: string }>(
      'SELECT count(*)::text AS n FROM quote_templates WHERE is_active AND id <> $1',
      [id],
    );
    if (Number(left[0]?.n ?? 0) === 0) {
      throw new AppError(40906, '这是最后一个启用的模板，不能删。', 409);
    }
  }
  await q('DELETE FROM quote_templates WHERE id = $1', [id]);
  return { deleted: true };
}

/**
 * 建单时确定用哪个模板，并把供应商名称拿出来给调用方快照。
 *
 * - 传了 id：必须存在且启用，否则报错——静默回落到默认模板会让报价单
 *   在客户眼里换了家供应商，而操作的人毫不知情。
 * - 没传：用默认模板；默认模板没设（历史数据）就取排序第一的启用模板。
 * - 一个启用的都没有：返回 null，抬头那格印「—」，**不阻断建单**。
 */
export async function resolveTemplateForCreate(
  templateId: string | null | undefined,
): Promise<{ id: string | null; supplier_name: string | null; layout: TemplateLayout | null }> {
  if (templateId) {
    const rows = await q<{ id: string; supplier_name: string; layout: TemplateLayout | null; is_active: boolean }>(
      'SELECT id, supplier_name, layout, is_active FROM quote_templates WHERE id = $1',
      [templateId],
    );
    const t = rows[0];
    if (!t) throw new AppError(40003, '选的报价单模板不存在，刷新页面重新选一次。', 400, { field: 'template_id' });
    if (!t.is_active) {
      throw new AppError(40003, '这个模板已停用，换一个模板再建单。', 400, { field: 'template_id' });
    }
    return { id: t.id, supplier_name: t.supplier_name, layout: t.layout ?? null };
  }
  const rows = await q<{ id: string; supplier_name: string; layout: TemplateLayout | null }>(
    `SELECT id, supplier_name, layout FROM quote_templates WHERE is_active
      ORDER BY is_default DESC, sort_order, created_at LIMIT 1`,
  );
  const t = rows[0];
  return { id: t?.id ?? null, supplier_name: t?.supplier_name ?? null, layout: t?.layout ?? null };
}
