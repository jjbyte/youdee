'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatTimeRel } from '@/lib/format';
import { ROLE_CAPABILITIES, ROLE_LABEL, canManageUsers } from '@/domain/permissions';
import type { UserRecord } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';
import { IconPencil, IconPlus } from '@/components/icons';
import { useMe } from '@/lib/use-me';
import { UserEditorDrawer } from './user-editor-drawer';

/**
 * 用户与角色（§C.9）。
 *
 * 0.1.10 及以前这里是一张**只读**表：三个接口（POST / PATCH / DELETE）都在，
 * 界面上却只有一个「能看」，所以管理员开不了权限、停不了人、也帮不了忘密码的人。
 * 现在每行一个「编辑」、右上角一个「新建成员」，都落到同一个抽屉里。
 *
 * 非管理员看到的是**整页说明**，不是隐藏——隐藏会让人以为系统坏了。
 * 能力表来自 `domain/permissions.ts` 的 ROLE_CAPABILITIES，和判定函数同源。
 */
export function UsersPanel({ currentUserId }: { currentUserId: string | null }) {
  const { user: me } = useMe();
  const canEdit = me ? canManageUsers(me.role) : false;

  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await api.users({ limit: 100 });
      setUsers(p.items ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  const onSaved = useCallback(
    (u: UserRecord, created: boolean) => {
      // 就地替换这一行，不整表重拉：整表重拉会让「最近登录」这类字段跳动，
      // 而且列表顺序（启用在前）会把人换位置，刚改完的那行跑走最难找。
      setUsers((list) => {
        if (!list) return list;
        const i = list.findIndex((x) => x.id === u.id);
        if (i < 0) return [u, ...list];
        const next = list.slice();
        next[i] = u;
        return next;
      });
      setFlash(created ? `已建好「${u.name}」的账号，把密码当面给他。` : `已保存「${u.name}」的权限。`);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="panel">
        <div className="flex items-start justify-between gap-[var(--space-3)] mb-[var(--space-3)]">
          <div className="min-w-0">
            <div className="fw-semi t-sm">成员</div>
            <p className="t-2xs t-3 mt-[var(--space-1)]">
              角色只有两种，权限随角色走；改完立刻生效（不需要对方重新登录）。
            </p>
          </div>
          {canEdit ? (
            <Button variant="secondary" size="sm" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              新建成员
            </Button>
          ) : null}
        </div>

        {flash ? (
          <div className="t-xs t-success mb-[var(--space-2)]" role="status">
            {flash}
          </div>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        {!users && !error ? <InlineLoading label="正在读成员…" /> : null}
        {users ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>成员</Th>
                  <Th>角色</Th>
                  <Th>状态</Th>
                  <Th>最近登录</Th>
                  <Th align="right">{canEdit ? '操作' : ''}</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      {u.name}
                      {u.id === currentUserId ? <span className="t-2xs t-3 ml-[var(--space-2)]">（你）</span> : null}
                      <span className="cell-sub">{u.login}</span>
                    </Td>
                    <Td>
                      <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
                    </Td>
                    <Td>
                      {u.isActive ? (
                        <span className="t-xs">正常</span>
                      ) : (
                        <span className="t-xs t-3">已停用</span>
                      )}
                    </Td>
                    <Td>
                      <span className="t-xs t-3">{formatTimeRel(u.lastLoginAt)}</span>
                    </Td>
                    <Td align="right">
                      {canEdit ? (
                        <IconButton label={`编辑「${u.name}」的权限`} onClick={() => setEditing(u)}>
                          <IconPencil size={16} />
                        </IconButton>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
      </div>

      <div className="panel">
        <div className="fw-semi t-sm mb-[var(--space-1)]">能力</div>
        <p className="t-2xs t-3 mb-[var(--space-3)]">
          这张表就是权限判定本身——代码里两个函数各取各的，不合并成一个「能不能改价」。
        </p>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>能力</Th>
                <Th align="center">管理员</Th>
                <Th align="center">成员</Th>
              </tr>
            </thead>
            <tbody>
              {ROLE_CAPABILITIES.map((c) => (
                <tr key={c.label}>
                  <Td>{c.label}</Td>
                  <Td align="center">{c.admin ? '可' : '不可'}</Td>
                  <Td align="center" className={c.member ? undefined : 't-3'}>
                    {c.member ? '可' : '不可'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      <Note tone="neutral">
        成员能录价、能手填成本，这看起来是放开了，但风险其实更低：手填成本是「没有记录、无法追溯的错数」，
        录进库的错价至少「有记录、有署名、可被下一条版本覆盖」。
      </Note>

      {!canEdit ? (
        <Note tone="neutral">
          你是成员，这一页只能看。要改谁的角色、停用账号或重设密码，让管理员来做。
        </Note>
      ) : null}

      <UserEditorDrawer
        open={creating || !!editing}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={onSaved}
        onDeleted={(id, note) => {
          setUsers((list) => (list ? list.filter((x) => x.id !== id) : list));
          setFlash(note);
        }}
      />
    </div>
  );
}
