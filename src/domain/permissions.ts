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

/** 覆盖/停用已有价格、改折算系数与交易性质、刷新草稿、删主体删供应商：仅 admin */
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

/** 用户与权限管理 */
export function canManageUsers(role: Role): boolean {
  return role === 'admin';
}

/** 供应商/分类/主体维护 */
export function canManageCatalog(role: Role): boolean {
  return role === 'admin';
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
