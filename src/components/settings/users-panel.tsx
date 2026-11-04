'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatTimeRel } from '@/lib/format';
import type { Role, UserRecord } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';

const CAPABILITIES: Array<{ label: string; admin: string; member: string }> = [
  { label: '查价 · 比价 · 看趋势', admin: '可', member: '可' },
  { label: '新建报价单 · 出单', admin: '可', member: '可' },
  { label: '屏幕看成本与毛利', admin: '可', member: '可' },
  { label: '手填成本（只影响本单）', admin: '可', member: '可' },
  { label: '新建一条价（含版本化复制）', admin: '可', member: '可' },
  { label: '覆盖 / 停用已有价', admin: '可', member: '不可' },
  { label: '改交易性质 / 折算系数', admin: '可', member: '不可' },
  { label: '导出客户版', admin: '可', member: '可' },
  { label: '导出内部版（含成本）', admin: '可', member: '不可' },
  { label: '供应商档案 / 分类字典', admin: '可', member: '不可' },
  { label: '设置项 / 账号管理', admin: '可', member: '不可' },
];

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' };

/**
 * 用户与角色（§C.9）。
 *
 * 非管理员看到的是**置灰 + 说明**，不是隐藏——隐藏会让人以为系统坏了。
 * 这份能力表要逐行能对上代码里的 `domain/permissions.ts`，两边不一致就是 bug。
 */
export function UsersPanel({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .users({ limit: 100 })
      .then((p) => setUsers(p.items ?? []))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="panel">
        <div className="fw-semi t-sm mb-[var(--space-3)]">成员</div>
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
              {CAPABILITIES.map((c) => (
                <tr key={c.label}>
                  <Td>{c.label}</Td>
                  <Td align="center">{c.admin}</Td>
                  <Td align="center" className={c.member === '不可' ? 't-3' : undefined}>
                    {c.member}
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
    </div>
  );
}
