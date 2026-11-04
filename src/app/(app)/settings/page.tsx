'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import { canManageUsers } from '@/domain/permissions';
import { Note } from '@/components/ui/states';
import { Field, Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { UsersPanel } from '@/components/settings/users-panel';
import { QuoteRulesPanel } from '@/components/settings/quote-rules-panel';
import { CategoriesPanel } from '@/components/settings/categories-panel';

type Section = 'users' | 'categories' | 'rules' | 'template' | 'export' | 'system';

const NAV: Array<{ key: Section; label: string; adminOnly?: boolean }> = [
  { key: 'users', label: '用户与角色', adminOnly: true },
  { key: 'categories', label: '分类字典', adminOnly: true },
  { key: 'rules', label: '比价与计价规则', adminOnly: true },
  { key: 'template', label: '报价单模板' },
  { key: 'export', label: '导出与打印' },
  { key: 'system', label: '系统' },
];

/**
 * 设置（§C.9）。左侧 200px 二级导航 + 右侧单栏内容，**不用 Tab**（Tab 在设置页会横向溢出）。
 *
 * 非管理员看到的改价能力行带锁 + 说明，不是隐藏——隐藏会让人以为系统坏了。
 */
export default function SettingsPage() {
  const { user, ready } = useMe();
  const isAdmin = user ? canManageUsers(user.role) : false;
  const [section, setSection] = useState<Section>('users');

  const visible = NAV.filter((n) => !n.adminOnly || isAdmin);
  const active = visible.some((n) => n.key === section) ? section : (visible[0]?.key ?? 'system');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-xl">设置</h1>
          <p className="t-sm t-3 mt-[var(--space-1)]">
            凡是「客户实际情况可能不同」的数字都在这里改，不写死在代码里。
          </p>
        </div>
      </div>

      <div className="settings mt-[var(--space-5)]">
        <nav className="flex flex-col gap-[var(--space-1)]" aria-label="设置导航">
          {visible.map((n) => (
            <button
              key={n.key}
              type="button"
              className="nav-item text-left"
              aria-current={active === n.key ? 'page' : undefined}
              onClick={() => setSection(n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {active === 'users' ? <UsersPanel currentUserId={user?.id ?? null} /> : null}
          {active === 'categories' ? <CategoriesPanel /> : null}
          {active === 'rules' ? <QuoteRulesPanel /> : null}

          {active === 'template' ? (
            <div className="flex flex-col gap-[var(--space-5)]">
              <div className="panel">
                <div className="fw-semi t-sm mb-[var(--space-3)]">公司信息（印在客户版页脚）</div>
                <CompanyForm />
              </div>
              <Note tone="neutral">
                客户版模板只准出现四个概念：单价、数量、金额、合计。
                「成本」「毛利」「加价」「参考最低价」连出现在页脚里都不行——
                客户版是服务端从独立 DTO 重新渲染的，不是把屏幕上这版藏掉几列。
              </Note>
            </div>
          ) : null}

          {active === 'export' ? (
            <div className="flex flex-col gap-[var(--space-4)]">
              <div className="panel">
                <div className="fw-semi t-sm mb-[var(--space-3)]">两条独立导出路径</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">能力</th>
                      <th scope="col">管理员</th>
                      <th scope="col">成员</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>导出客户版（PDF / Excel）</td>
                      <td>可</td>
                      <td>可</td>
                    </tr>
                    <tr>
                      <td>导出内部版（含成本）</td>
                      <td>可</td>
                      <td className="t-3">不可</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Note tone="neutral">
                限制内部版的定性是「降低顺手转发」，不是保密——成员屏幕上本来就能看到成本，截图照样能截。
                所以界面上不写任何承诺性措辞（不出现「安全」「保密」「防泄露」）。
              </Note>
              <Note tone="warn">
                客户版 PDF 目前走浏览器打印（A4、正文 12pt）。服务端还没有 PDF 渲染器，
                分页点由浏览器决定，不是服务端给的——这一点和文档里的「所见即所印」有差距，先照实说。
              </Note>
            </div>
          ) : null}

          {active === 'system' ? (
            <div className="flex flex-col gap-[var(--space-4)]">
              <div className="panel">
                <div className="fw-semi t-sm mb-[var(--space-2)]">你现在是谁</div>
                <p className="t-sm">
                  {ready ? (user ? `${user.name}（${user.login}）· ${user.role === 'admin' ? '管理员' : '成员'}` : '没读到当前账号') : '正在读…'}
                </p>
              </div>
              <div className="panel">
                <div className="fw-semi t-sm mb-[var(--space-2)]">刷新价入口还没接</div>
                <p className="t-sm t-2">
                  批量核对 / 刷新价是一个两步动作（预览改了什么 → 再确认），不是弹一个「确定吗」。
                  接口还没有，所以这一页不给按钮——给一个点了没反应的按钮比不给更糟。
                </p>
              </div>
            </div>
          ) : null}

          {!isAdmin && active === 'system' ? (
            <Note tone="neutral" className="mt-[var(--space-4)]">
              你是成员。改价、停用价、供应商档案、分类字典、设置项都要管理员做——你可以录一条新的价。
            </Note>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompanyForm() {
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '', taxNo: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .company()
      .then((c) =>
        setForm({
          name: c.name ?? '',
          address: c.address ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          taxNo: c.taxNo ?? '',
        }),
      )
      .catch(() => setMessage('公司信息没读出来，先手填也行。'));
  }, []);

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <Field label="公司名" htmlFor="co-name">
        <Input id="co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="地址" htmlFor="co-address">
        <Input id="co-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-[var(--space-3)]">
        <Field label="电话" htmlFor="co-phone">
          <Input id="co-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="邮箱" htmlFor="co-email">
          <Input id="co-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
      </div>
      <Field label="税号" htmlFor="co-tax" hint="客户版只在需要开票时用，不打印在报价单正文。">
        <Input id="co-tax" value={form.taxNo} onChange={(e) => setForm({ ...form, taxNo: e.target.value })} />
      </Field>
      <div className="flex items-center gap-[var(--space-3)]">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.updateCompany(form);
              setMessage('存好了。客户版页脚会立刻用上。');
            } catch {
              setMessage('没存上。稍后再试，或者先别关页面。');
            } finally {
              setBusy(false);
            }
          }}
        >
          保存
        </Button>
        {message ? <span className="t-xs t-2">{message}</span> : null}
      </div>
    </div>
  );
}
