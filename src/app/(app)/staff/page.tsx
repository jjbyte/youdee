import { StaffLibrary } from '@/components/staff/staff-library';

/**
 * 人员库（§C.5）。页面壳很薄，主体在 components/staff/staff-library，
 * 因为「嘉宾价」是同主体换一个预置筛选的另一个路由。
 *
 * 老链接 `/staff?category=guest` 仍然认（组件内部读一次 URL），
 * 新入口是 `/guests` —— 见 StaffLibrary 顶部的说明：同一 pathname 换 query 不会重挂载。
 */
export default function StaffPage() {
  return <StaffLibrary />;
}
