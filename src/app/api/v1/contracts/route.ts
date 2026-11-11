import { body, ok, requireUser, searchParams } from '@/server/http';
import { dateParam, pageQuery } from '@/server/params';
import { route } from '@/server/wrap';
import { createContract, listContracts } from '@/server/services/contract.service';

/**
 * 合同台账。
 *
 * 读：任何登录用户。合同不是机密——查不到合同才真会出事。
 * 写：任何登录用户。录入是行政活，卡在管理员身上就会变成"管理员不在就录不进去"。
 * 删：管理员（软删，可恢复），见 [id]/route.ts。
 *
 * 查询维度照客户的 Excel 口径：合同编号 / 合同名称 / 公司（甲方）/ 客户（乙方）/
 * 签订日期区间 / 创建日期区间。`q` 是兜底：六个字段一起模糊。
 */
export const GET = route(async (req) => {
  const actor = await requireUser();
  const sp = searchParams(req);
  const hasFileRaw = sp.get('has_file');
  const hasFile = hasFileRaw === '1' || hasFileRaw === 'true' ? true : hasFileRaw === '0' || hasFileRaw === 'false' ? false : null;

  // 「已删除」只给管理员看：成员看到一堆灰行却恢复不了，只会误以为合同丢了
  const wantDeleted = sp.get('include_deleted') === '1' || sp.get('include_deleted') === 'true';
  const txt = (k: string) => (sp.get(k) ?? '').trim() || null;

  return ok(
    await listContracts({
      q: txt('q'),
      contractNo: txt('contract_no'),
      title: txt('title'),
      company: txt('company'),
      customer: txt('customer'),
      project: txt('project'),
      signedFrom: dateParam(sp, 'signed_from'),
      signedTo: dateParam(sp, 'signed_to'),
      createdFrom: dateParam(sp, 'created_from'),
      createdTo: dateParam(sp, 'created_to'),
      hasFile,
      includeDeleted: wantDeleted && actor.role === 'admin',
      page: pageQuery(sp),
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireUser();
  const b = await body<Record<string, unknown>>(req);
  return ok(await createContract(b, actor), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
