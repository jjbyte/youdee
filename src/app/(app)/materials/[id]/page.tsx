'use client';
import { SubjectComparePage } from '@/components/compare/subject-compare-page';

/** 物料比价页（§C.4）。逻辑全在 SubjectComparePage（人员详情复用同一个组件）。 */
export default function MaterialComparePage() {
  return <SubjectComparePage kind="material" />;
}
