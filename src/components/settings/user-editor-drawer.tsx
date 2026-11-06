'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { ROLE_LABEL, deniedCapabilities, type Role } from '@/domain/permissions';
import { cx } from '@/lib/format';
import type { UserRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/**
 * 新建 / 编辑账号与权限（§C.9）。
 *
 * 为什么要有这个抽屉：`POST /users`、`PATCH /users/:id`、`DELETE /users/:id`
 * 三个接口在 0.1.0 就写好了，但设置页只有一个**只读**的成员表——
 * 管理员能看到「小王是成员」，却没有办法把他升成管理员、停用他、或者帮他重设密码。
 * 权限开不了＝这套系统只能一个人用。
 *
 * 三条界面上的硬规则（都能在服务端找到对应的拒绝码，不是只在界面上拦）：
 *   · 不能改自己的角色、不能停用自己（40904）——「把自己锁在门外」；
 *   · 系统至少保留一个启用的管理员（40904）；
 *   · 密码至少 10 位，且不能等于登录名（40001）。
 *
 * 不下发「登录名不可改」的隐藏假设：接口不支持改登录名（它是台账里的署名），
 * 所以编辑态直接只读展示，并把理由写在旁边。
 */
export function UserEditorDrawer({
  open,
  user,
  currentUserId,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  /** null = 新建 */
  user: UserRecord | null;
  currentUserId: string | null;
  onClose: () => void;
  onSaved: (u: UserRecord, created: boolean) => void;
  /** 真删成功后把它从列表里摘掉（不整表重拉，避免刚删的那行跳位置） */
  onDeleted?: (id: string, note: string) => void;
}) {
  const isCreate = !user;
  const isSelf = !!user && user.id === currentUserId;

  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLogin(user?.login ?? '');
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
    setRole((user?.role as Role) ?? 'member');
    setIsActive(user ? user.isActive : true);
    setPassword('');
    setError(null);
    setConfirmDelete(false);
  }, [open, user]);

  async function submit() {
    const l = login.trim();
    const n = name.trim();
    if (!n) {
      setError('姓名不能空着——报价单和台账里署名用的就是它。');
      return;
    }
    if (isCreate && !/^[a-zA-Z0-9_.-]{2,40}$/.test(l)) {
      setError('登录名用 2–40 位字母、数字、下划线、点或短横线。');
      return;
    }
    if (password && password.length < 10) {
      setError('密码至少 10 位。');
      return;
    }
    if (isCreate && !password) {
      setError('新建账号要给一个初始密码（至少 10 位）。');
      return;
    }
    if (password && password === (isCreate ? l : (user?.login ?? ''))) {
      setError('密码不能和登录名相同。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isCreate) {
        const created = await api.createUser({ login: l, name: n, password, role, phone: phone.trim() || null });
        onSaved(created, true);
      } else {
        const updated = await api.updateUser(user.id, {
          name: n,
          phone: phone.trim() || null,
          // 自己的角色/状态不发：服务端会 40904，但让按钮点了才报错是耍人
          ...(isSelf ? {} : { role, isActive }),
          ...(password ? { password } : {}),
        });
        onSaved(updated, false);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 真删。服务端会先查名下有没有报价单：
   * 有就 409 并说明张数——那时正确做法是停用，而不是把错误信息当障碍绕过去。
   */
  async function remove() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteUser(user.id);
      // 价格记录仍在、只是署名没了——这句话必须让人看见，不能静默
      onDeleted?.(
        user.id,
        r.pricesUnsigned > 0
          ? `已删除「${user.name}」。历史价格记录保留，其中 ${r.pricesUnsigned} 条的录入人署名已清空。`
          : `已删除「${user.name}」，登录名可以重新建号。`,
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const denied = deniedCapabilities(role);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isCreate ? '新建成员' : '编辑权限'}
      subtitle={isCreate ? '登录名建好之后不能改' : `${user?.name ?? ''} · ${user?.login ?? ''}`}
      closeOnScrim={false}
      footer={
        <>
          {!isCreate && !isSelf && user?.role === 'member' ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
              删除成员
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {isCreate ? '建这个账号' : '保存'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <Field
          label="登录名"
          htmlFor="ue-login"
          required={isCreate}
          hint={isCreate ? '建议用姓名拼音或手机号短码，2–40 位。' : '登录名是台账里的署名，建好不能改；要换请新建账号。'}
        >
          <Input
            id="ue-login"
            value={login}
            readOnly={!isCreate}
            disabled={!isCreate}
            autoComplete="off"
            onChange={(e) => setLogin(e.target.value)}
            placeholder="例：xiaowang"
          />
        </Field>

        <Field label="姓名" htmlFor="ue-name" required hint="会显示在顶栏、报价单的「制单人」和操作记录里。">
          <Input id="ue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：王小明" />
        </Field>

        <Field
          label="电话"
          htmlFor="ue-phone"
          hint="印在报价单抬头的那一个号，客户对不上人时会打它。留空则抬头不显示电话。"
        >
          <Input
            id="ue-phone"
            className="num-code"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="例：138 0000 0001"
          />
        </Field>

        <Field
          label="角色（决定能做什么）"
          hint={isSelf ? '不能改自己的角色：把自己降权之后就没人能改回来了。请让另一个管理员来操作。' : undefined}
        >
          <div className="grid grid-cols-2 gap-[var(--space-3)]" role="radiogroup" aria-label="角色">
            {(['admin', 'member'] as Role[]).map((r) => {
              const on = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={isSelf}
                  onClick={() => setRole(r)}
                  className={cx(
                    'text-left px-[var(--space-3)] py-[var(--space-3)] rounded-[var(--radius-lg)] border',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]',
                    isSelf && !on && 'opacity-50',
                    isSelf && 'cursor-not-allowed',
                  )}
                >
                  <div className="fw-semi t-sm">{ROLE_LABEL[r]}</div>
                  <div className="t-2xs t-2 mt-[var(--space-1)]">
                    {r === 'admin' ? '全部能力，含改别人的价、管账号' : '查价、建单、录价；不能覆盖旧价'}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        {denied.length ? (
          <Note tone="neutral">
            <span className="fw-semi">{ROLE_LABEL[role]}做不到：</span>
            {denied.join('、')}。
          </Note>
        ) : (
          <Note tone="warn">
            管理员能覆盖别人的价、导出含成本的内部版、管账号。除非确实需要，否则给「成员」。
          </Note>
        )}

        <label className={cx('switch', isSelf && 'opacity-50 cursor-not-allowed')}>
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          启用
          <span className="t-2xs t-3">
            {isSelf ? '（不能停用自己）' : '（停用后立刻登不进来，历史报价单仍显示他的名字）'}
          </span>
        </label>

        <Field
          label={isCreate ? '初始密码' : '重置密码'}
          htmlFor="ue-pwd"
          required={isCreate}
          hint={
            isCreate
              ? '至少 10 位。建好后把账号密码当面给本人，系统不发通知。'
              : isSelf
                ? '留空表示不改。改自己的密码会让你当前这台设备立刻掉线，需要用新密码重新登录。'
                : '留空表示不改。重置后对方当前的登录会话立即失效，需要用新密码重新登录。'
          }
        >
          <Input
            id="ue-pwd"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isCreate ? '' : '不改就留空'}
          />
        </Field>

        {confirmDelete ? (
          <Note tone="danger">
            <div className="fw-semi mb-[var(--space-2)]">确定删除「{user?.name}」这个账号？</div>
            <p className="t-xs">
              删掉之后这个账号从库里消失，同名登录名可以重新建一个。这是不可逆的。
              如果他名下已经有报价单，系统会拦住并告诉你张数——那种情况请改用上面的「启用」开关停用：
              他立刻登不进来，单据上还是他的名字。
            </p>
            <div className="flex gap-[var(--space-2)] mt-[var(--space-3)]">
              <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
                确认删除
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                算了
              </Button>
            </div>
          </Note>
        ) : null}

        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
