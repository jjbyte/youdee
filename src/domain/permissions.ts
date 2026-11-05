/**
 * 权限判定（唯一出口）。
 *
 * 铁律：两个函数不许合并成 `canEditPrice`。
 * 合并后最先出的不是安全问题，是「member 点新建被连带禁用」。
 *
 * 为什么允许成员录价在风险上反而更低（客户 2026-11-04 选定方案 c）：
 *   手填成本是"没有记录、无法追溯、无法纠正的错数"；
 *   录进库的错价至少"有记录、有署名、可被下一条版本覆盖"。
 *   在成员已经能手填的前提下，禁止他录价，在风险上是更差的那个选择。
 */

export type Role = 'admin' | 'member';

/** 新建价格：admin 与 member 都可 */
export function canCreatePrice(role: Role): boolean {
  return role === 'admin' || role === 'member';
}

/** 覆盖已有价、改折算系数与交易性质、刷新草稿：仅 admin（作废/恢复不在此列，见 canArchive） */
export function canOverridePrice(role: Role): boolean {
  return role === 'admin';
}

/** 屏幕可见成本：两者都可（不算毛利就看不了价） */
export function canViewCost(_role: Role): boolean {
  return true;
}

/** 导出含成本的内部版：仅 admin。区分逻辑：屏幕可见是即时行为，导出文件是可转发资产 */
export function canExportInternal(role: Role): boolean {
  return role === 'admin';
}

/**
 * 作废 / 恢复：**两种角色都可**（2026-11-05 客户要求）。
 *
 * 这里的分界不是"重要性"，是**可逆性**：
 *   作废只是换个状态，一条「恢复」就回来了，误操作的代价是几秒钟；
 *   删除是真的从库里消失，误操作的代价是一下午的重新录价。
 * 把可逆动作也锁成管理员，结果不是更安全，是成员攒了一堆废单废料没人清，
 * 或者干脆绕开系统在 Excel 里做——那才是最糟的安全状态。
 */
export function canArchive(role: Role): boolean {
  return role === 'admin' || role === 'member';
}

/** 删除记录（报价单 / 物料 / 人员 / 物料价 / 供应商）：仅 admin，不可恢复 */
export function canDeleteRecord(role: Role): boolean {
  return role === 'admin';
}

/** 用户与权限管理 */
export function canManageUsers(role: Role): boolean {
  return role === 'admin';
}

/** 供应商/分类/主体维护 */
export function canManageCatalog(role: Role): boolean {
  return role === 'admin';
}

/**
 * 能力清单（给界面用的**展示**数据，不放判定逻辑）。
 *
 * 放在这个文件里是故意的：判定函数和这张表必须逐行对得上，
 * 分两个文件放早晚会漂移——界面上写着「成员可覆盖旧价」，代码里却返回 false。
 * 改任何一个函数，都要顺手看这张表。
 */
export interface RoleCapability {
  label: string;
  admin: boolean;
  member: boolean;
}

export const ROLE_CAPABILITIES: RoleCapability[] = [
  { label: '查价 · 比价 · 看趋势', admin: true, member: true },
  { label: '新建报价单 · 出单', admin: true, member: true },
  { label: '屏幕上看成本与毛利', admin: true, member: true },
  { label: '手填成本（只影响本单）', admin: true, member: true },
  { label: '新建一条价（含版本化复制）', admin: true, member: true },
  { label: '作废 / 恢复（可反悔）', admin: true, member: true },
  { label: '覆盖 / 停用已有价', admin: true, member: false },
  { label: '改交易性质 / 折算系数', admin: true, member: false },
  { label: '删除报价单 / 物料 / 人员 / 价 / 供应商', admin: true, member: false },
  { label: '导出客户版', admin: true, member: true },
  { label: '导出内部版（含成本）', admin: true, member: false },
  { label: '供应商档案 / 分类字典', admin: true, member: false },
  { label: '设置项 / 账号管理', admin: true, member: false },
];

export const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' };

/** 这个角色做不到的事（编辑权限时最该被看见的就是这一列） */
export function deniedCapabilities(role: Role): string[] {
  return ROLE_CAPABILITIES.filter((c) => !c[role]).map((c) => c.label);
}

/**
 * 成员走「新建一条价」时，这四个字段不得与上一条版本不一致 ——
 * 服务端 422 拒绝，不能只靠界面灰显（Spec §5.2 红线 3）。
 * 理由：这四个字段换了任何一个，等于换掉了一个被比较的对象。
 */
export const VERSIONED_LOCKED_FIELDS = [
  'supplier_id',
  'unit_code',
  'pricing_nature',
  'base_unit_qty',
] as const;

export type VersionedLockedField = (typeof VERSIONED_LOCKED_FIELDS)[number];
