/**
 * 报价单状态机（唯一出口）。
 *
 * 三态：draft / issued / void。`expired` 由 valid_until 派生，不落库。
 * 禁止在组件里写 `status === 'issued'` —— 将来加状态只改一处。
 *
 * 本文件同时承载「阻断边界」这条最重要的规则：
 *   disabled = 有行没成本。
 *   负毛利、软陈旧、非最低价、手填成本 —— 一律只 warning，永不阻断。
 *
 * 为什么这条这么重要：新库第一天大量主体没价（必然）。若"无价 → 禁用出单"，
 * 用户勾 8 行有 4 行没价 → 按钮灰着 → 出不了单 → 回 Excel → 产品首日就死。
 */

export type QuoteStatus = 'draft' | 'issued' | 'void';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: '草稿',
  issued: '已发出',
  void: '已作废',
};

/** 派生：已过报价有效期（不落库） */
export function isExpired(status: QuoteStatus, validUntil: string, today: string): boolean {
  return status === 'issued' && validUntil < today;
}

export function canEdit(status: QuoteStatus): boolean {
  return status === 'draft';
}

/**
 * 删除：**不看状态，只看角色**（admin，判定在 permissions.canDeleteRecord）。
 *
 * 这里原来写的是 `status === 'draft'`——那是"只有草稿能删"的时代定的。
 * 2026-11-05 客户明确要求管理员能删已发出的单（重复建、建错了要清掉），
 * 状态不再是删除的边界；「删了就没台账」这件事由 requireDelete 的确认弹窗承担。
 */
export function canDelete(_status: QuoteStatus): boolean {
  return true;
}

/** 出单前置：只有草稿能发。真正的内容校验在 risk-check，不在这里 */
export function canIssue(status: QuoteStatus): boolean {
  return status === 'draft';
}

/**
 * 作废：草稿与已发出都能作废。
 *
 * 草稿也必须能作废，否则**成员会走进死胡同**：他不能删（删除是管理员专属），
 * 又不能作废（原来只允许 issued），一张建错的草稿就永远挂在草稿列表里。
 * 唯一的出路是找管理员删——为了清一张空单去打扰人，这种系统没人愿意用。
 */
export function canVoid(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'issued';
}

/** 恢复：只有已作废的能恢复。回到哪个状态由 issued_at 决定，见 quote-actions */
export function canRestore(status: QuoteStatus): boolean {
  return status === 'void';
}

/** 改版重报：已发出的单可以复制成新版本，不能原地改 */
export function canDuplicate(status: QuoteStatus): boolean {
  return status === 'issued' || status === 'void';
}

export interface BlockingInput {
  /** 有行缺成本（cost_source=manual 且未填） */
  hasLineWithoutCost: boolean;
  customerName: string;
  eventName: string;
}

export interface BlockingResult {
  /** 只有为 true 时才禁用「生成报价单」 */
  blocked: boolean;
  /** 阻断原因的界面文案。空数组 = 可出单 */
  blockers: string[];
}

/**
 * 出单阻断判定。**唯一 blocker 是"客户名/活动名为空"与"有行没成本"。**
 * 注意：负毛利不阻断 —— 有些单是故意亏的（走量、拿案例、维护关系），
 * 阻断会逼用户绕过系统。
 */
export function evaluateIssueBlocking(input: BlockingInput): BlockingResult {
  const blockers: string[] = [];
  if (!input.customerName.trim()) blockers.push('客户名称为空，客户版无法发出');
  if (!input.eventName.trim()) blockers.push('活动名称为空');
  if (input.hasLineWithoutCost) blockers.push('有明细行还没填成本，请先补上或删除该行');
  return { blocked: blockers.length > 0, blockers };
}
