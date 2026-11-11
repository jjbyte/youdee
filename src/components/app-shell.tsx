'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, errorMessage, isUnauthorized } from '@/lib/api';
import type { CurrentUser } from '@/lib/types';
import {
  IconCollapse,
  IconContract,
  IconDensity,
  IconLogout,
  IconMaterial,
  IconQuote,
  IconSearch,
  IconSettings,
  IconStaff,
  IconVendor,
} from '@/components/icons';
import { IconButton } from '@/components/ui/button';
import { ErrorState, TableSkeleton } from '@/components/ui/states';

function crumbs(pathname: string): string[] {
  if (pathname === '/') return ['工作台'];
  if (pathname.startsWith('/materials')) {
    return pathname === '/materials' ? ['物料库'] : ['物料库', '比价'];
  }
  if (pathname.startsWith('/staff')) return pathname === '/staff' ? ['人员库'] : ['人员库', '人员比价'];
  // 嘉宾价不是独立模块，是人员库的一个预置筛选视图，面包屑挂在人员库下面
  if (pathname.startsWith('/guests')) return ['人员库', '嘉宾价'];
  if (pathname.startsWith('/vendors')) return ['供应商'];
  // 合同管理是独立台账，不是报价单的附属：合同先于报价签，两边各自查各自的
  if (pathname.startsWith('/contracts')) return ['合同管理'];
  if (pathname.startsWith('/quotes')) {
    if (pathname === '/quotes') return ['报价单'];
    if (pathname.endsWith('/edit')) return ['报价单', '编辑'];
    if (pathname.endsWith('/preview')) return ['报价单', '客户版'];
    return ['报价单'];
  }
  if (pathname.startsWith('/settings')) return ['设置'];
  return ['有底'];
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [collapsed, setCollapsed] = useState(false);
  const [density, setDensity] = useState<'compact' | 'standard' | 'comfortable'>('standard');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const u = await api.me();
      setUser(u);
      setStatus('ready');
    } catch (e) {
      if (isUnauthorized(e)) {
        router.replace('/login');
        return;
      }
      setError(errorMessage(e));
      setStatus('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const c = window.localStorage.getItem('yd.sidebar.collapsed');
      if (c === '1') setCollapsed(true);
      const d = window.localStorage.getItem('yd.density');
      if (d === 'compact' || d === 'comfortable' || d === 'standard') setDensity(d);
    } catch {
      /* localStorage 不可用时保持默认，不阻断 */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try {
      window.localStorage.setItem('yd.density', density);
    } catch {
      /* 同上 */
    }
  }, [density]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem('yd.sidebar.collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* 退出失败也照样跳登录，Cookie 过期即无法访问 */
    }
    router.replace('/login');
  }

  if (status === 'loading') {
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

  if (status === 'error') {
    return (
      <div className="page">
        <ErrorState message={error || '这个页面没加载出来。'} onRetry={() => void load()} />
      </div>
    );
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="shell" data-collapsed={collapsed}>
      <nav className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          {!collapsed ? <span className="brand-name">有底</span> : null}
        </div>

        <NavLink href="/" label="工作台" collapsed={collapsed} active={isActive('/')} icon={<IconDensity size={20} />} />
        <NavLink
          href="/materials"
          label="物料库"
          collapsed={collapsed}
          active={isActive('/materials')}
          icon={<IconMaterial size={20} />}
        />
        <NavLink
          href="/staff"
          label="人员库"
          collapsed={collapsed}
          // 嘉宾价是人员库的视图，不是第二个模块：老书签打开 /guests 时高亮「人员库」
          active={isActive('/staff') || isActive('/guests')}
          icon={<IconStaff size={20} />}
        />
        {/* 「嘉宾价」不再挂侧栏：它是人员库的一个预置筛选视图（分类锁「专业嘉宾」），
            两个入口并存只会让人以为这是两个模块。路由 `/guests` 保留，老书签仍能用。 */}
        <NavLink
          href="/vendors"
          label="供应商"
          collapsed={collapsed}
          active={isActive('/vendors')}
          icon={<IconVendor size={20} />}
        />
        <NavLink
          href="/contracts"
          label="合同管理"
          collapsed={collapsed}
          active={isActive('/contracts')}
          icon={<IconContract size={20} />}
        />
        <NavLink
          href="/quotes"
          label="报价单"
          collapsed={collapsed}
          active={isActive('/quotes')}
          icon={<IconQuote size={20} />}
        />

        <div className="nav-spacer" />

        <NavLink
          href="/settings"
          label="设置"
          collapsed={collapsed}
          active={isActive('/settings')}
          icon={<IconSettings size={20} />}
        />
        <button type="button" className="nav-collapse" onClick={toggleCollapsed} aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}>
          <IconCollapse size={20} />
          {!collapsed ? <span className="t-sm">折叠</span> : null}
        </button>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbs(pathname).map((c, i, arr) => (
              <span key={`${c}-${i}`} className="flex items-center gap-[var(--space-2)]">
                {i === arr.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
                {i < arr.length - 1 ? <span aria-hidden="true">/</span> : null}
              </span>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <form
            className="hidden md:block"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const q = String(fd.get('q') || '').trim();
              router.push(q ? `/materials?q=${encodeURIComponent(q)}` : '/materials');
            }}
          >
            <div className="search" style={{ width: '240px' }}>
              <IconSearch size={16} />
              <input className="input" name="q" placeholder="搜物料 / 人员" aria-label="全局搜索" />
            </div>
          </form>
          <IconButton
            label={`切换密度（当前${density === 'compact' ? '紧凑' : density === 'comfortable' ? '宽松' : '标准'}）`}
            onClick={() =>
              setDensity((d) => (d === 'standard' ? 'compact' : d === 'compact' ? 'comfortable' : 'standard'))
            }
          >
            <IconDensity size={16} />
          </IconButton>
          <div className="flex items-center gap-[var(--space-3)]">
            <span className="t-sm t-2">{user?.name ?? ''}</span>
            <span className="badge badge--neutral">{user?.role === 'admin' ? '管理员' : '成员'}</span>
            <IconButton label="退出登录" onClick={() => void logout()}>
              <IconLogout size={16} />
            </IconButton>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      className="nav-item"
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed ? <span>{label}</span> : null}
    </Link>
  );
}
