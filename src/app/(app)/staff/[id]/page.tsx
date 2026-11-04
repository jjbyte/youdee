'use client';
import { SubjectComparePage } from '@/components/compare/subject-compare-page';

/**
 * 人员详情（§C.5）。
 * 结构与物料详情同一套（供应商行 → 各家报价 → 摘要），只是分组维度换成 `unit_mode`：
 * 按天 / 按场 / 按人天 / 按小时 / 按半天。**不传 items.pricing_mode 进去**，那是档案默认值。
 */
export default function StaffDetailPage() {
  return <SubjectComparePage kind="personnel" />;
}
