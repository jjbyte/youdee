import { body, ok, requireContractAccess, searchParams } from '@/server/http';
import { dateParam, pageQuery } from '@/server/params';
import { route } from '@/server/wrap';
import { createContract, listContracts } from '@/server/services/contract.service';
import { isContractCategory, isContractStatus } from '@/domain/contract';

/**
 * 合同台账。
 *
 * 权限：**整块仅管理员**（2026-11-17 客户要求，读也拦）。
 * 一支路由一个人判：`requireContractAccess()`，成员拿到 403，界面侧连导航都不给。
 * 这条口径改过的代价要写清楚：现在哪怕是"查一下这单签了没"也得管理员来，
 * 所以列表接口必须支持模糊 + 分页（见下面的 q 与 page），别让管理员靠翻页找人。
 *
 * 查询维度照客户的 Excel 口径：合同编号 / 合同名称 / 公司（甲方）/ 客户（乙方）/
 * 签订日期区间 / 创建日期区间。`q` 是兜底：六个字段一起模糊。
 */
export const GET = route(async (req) => {
  const actor = await requireContractAccess();
  const sp = searchParams(req);
  const hasFileRaw = sp.get('has_file');
  const hasFile = hasFileRaw === '1' || hasFileRaw === 'true' ? true : hasFileRaw === '0' || hasFileRaw === 'false' ? false : null;

  // 能走到这里的只有管理员，所以 include_deleted 实际就是"要不要连软删的一起看"
  const wantDeleted = sp.get('include_deleted') === '1' || sp.get('include_deleted') === 'true';
  const txt = (k: string) => (sp.get(k) ?? '').trim() || null;
  // 分类只有三个合法值：认不出的按"不筛"处理，不报错——
  // 筛选条件脏了应该出全部结果，而不是一页空白让人以为合同没了
  const rawCategory = txt('category');
  const category = isContractCategory(rawCategory) ? rawCategory : null;
  // 状态筛选：五态封闭枚举，认不出的按"不筛"处理（理由同上）
  const rawStatus = txt('status');
  const status = isContractStatus(rawStatus) ? rawStatus : null;

  return ok(
    await listContracts({
      q: txt('q'),
      contractNo: txt('contract_no'),
      title: txt('title'),
      company: txt('company'),
      customer: txt('customer'),
      project: txt('project'),
      category,
      status,
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
  const actor = await requireContractAccess();
  const b = await body<Record<string, unknown>>(req);
  return ok(await createContract(b, actor), 201);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
