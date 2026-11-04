import { StaffLibrary } from '@/components/staff/staff-library';

/**
 * 嘉宾价的直达地址（0.1.11 起侧栏不再挂入口，路由本身保留）。
 *
 * 它不是一个独立模块，而是人员库的一个**预置筛选视图**：分类锁在「专业嘉宾」。
 * 保留独立路由的原因：
 *   1. 老书签、别人发过的地址打开还得是这个视图，不能 404；
 *   2. 同一 pathname 只换 query 时，Next 不会重挂载组件，筛选不会生效——点了像没反应。
 */
export default function GuestsPage() {
  return <StaffLibrary guest />;
}
