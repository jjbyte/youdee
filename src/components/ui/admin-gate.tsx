'use client';
import type { ReactNode } from 'react';
import { useMe } from '@/lib/use-me';
import type { Role } from '@/domain/permissions';
import { IconRisk } from '@/components/icons';
import { EmptyState, TableSkeleton } from './states';

/**
 * 整块模块的访问闸门（合同管理 / 发票台账，2026-11-17 客户要求：成员连看都不给）。
 *
 * 为什么放在组件层而不是页面里写一句 `if (role !== 'admin') return <无权限/>`：
 *   1. 页面里所有 hook 都在这句之前跑完了，拦截只拦住渲染、拦不住 `useEffect` 里的
 *      请求 —— 结果是成员打开页面，后台照样发一次 403，控制台一片红。
 *      包一层之后，被包住的组件**根本不会挂载**，请求也就不会发。
 *   2. 两处门槛一模一样的文案与样式，写两遍就会漂。
 *
 * 只做**界面**这一半。真正的门在接口层（`requireContractAccess` / `requireInvoiceAccess`），
 * 两边判的是同一个纯函数；前端这层是"别让人看见一个点进去就报错的入口"。
 */
export function AdminGate({
  check,
  area,
  hint,
  children,
}: {
  /** 判定函数来自 domain/permissions.ts —— 不许在这里写 role === 'admin' */
  check: (role: Role) => boolean;
  /** 模块名，用在文案里：「合同管理只对管理员开放」 */
  area: string;
  /** 为什么只有管理员能看。空话（"权限不足"）在这里没有信息量 */
  hint: string;
  children: ReactNode;
}) {
  const { user, ready } = useMe();

  if (!ready) {
    return (
      <div className="page" aria-busy="true">
        <div className="page-head">
          <div>
            <div className="skeleton" style={{ width: '160px', height: '20px' }} />
            <div className="skeleton mt-[var(--space-3)]" style={{ width: '320px', height: '12px' }} />
          </div>
        </div>
        <TableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  // 未登录：交回外层 shell 处理（它会跳到登录页），这里不闪一个"无权限"
  if (!user) return null;

  if (!check(user.role)) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="t-xl">{area}</h1>
          </div>
        </div>
        <EmptyState
          title={`${area}只对管理员开放`}
          body={hint}
          icon={<IconRisk size={24} />}
          primary={{ label: '回到工作台', href: '/' }}
        />
      </div>
    );
  }

  return <>{children}</>;
}
