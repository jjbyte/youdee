/**
 * 站内通知。只读本人（user_id = 当前用户）——通知不是监控，
 * 让管理员能看别人的通知是另一个产品，而它会立刻改变团队里的说话方式。
 */
import { one, q } from '../db';
import { AppError } from '../http';

interface NotifRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  quote_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

function dto(r: NotifRow) {
  return {
    id: r.id,
    kind: r.type,
    title: r.title,
    body: r.body,
    ref_type: r.quote_id ? 'quote' : null,
    ref_id: r.quote_id,
    read_at: r.read_at ? r.read_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

export async function listNotifications(userId: string, unreadOnly: boolean, limit: number, offset: number) {
  const where = unreadOnly
    ? 'WHERE user_id = $1 AND read_at IS NULL'
    : 'WHERE user_id = $1';
  const total = await q<{ n: string }>(`SELECT count(*)::text AS n FROM notifications ${where}`, [userId]);
  const rows = await q<NotifRow>(
    `SELECT id, type, title, body, quote_id, read_at, created_at FROM notifications ${where}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [userId],
  );
  return {
    items: rows.map(dto),
    total: Number(total[0]?.n ?? 0),
    page: Math.floor(offset / limit) + 1,
    limit,
    hasMore: offset + rows.length < Number(total[0]?.n ?? 0),
  };
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await one<{ n: string }>(
    'SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return Number(row?.n ?? 0);
}

export async function markRead(userId: string, id: string) {
  const rows = await q<NotifRow>(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING id, type, title, body, quote_id, read_at, created_at`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) throw new AppError(40401, '这条通知不存在。', 404);
  return dto(row);
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await q<{ id: string }>(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id',
    [userId],
  );
  return rows.length;
}
