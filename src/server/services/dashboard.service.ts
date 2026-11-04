/**
 * 工作台概览。
 *
 * 两个质量指标只依赖 quote_items 的快照列（cost_source / price_id 关联的失效日），
 * 不做任何业务计算重跑：历史单的指标必须随时可重算且永远稳定，
 * 否则"上个月手填比例"会随着今天的改价而变化。
 */
import { q, today } from '../db';
import { staleDaysThreshold } from '../store/settings.store';
import { listQuotes } from './quote.service';
import { unreadCount } from './notifications.service';

export async function dashboardSummary(userId: string) {
  const todayStr = today();
  const stale = await staleDaysThreshold();

  const counts = await q<{
    material_count: string;
    personnel_count: string;
    supplier_count: string;
    price_count: string;
    expiring_price_count: string;
    draft_quote_count: string;
  }>(
    `SELECT
       (SELECT count(*) FROM items WHERE item_type='material' AND is_active)::text AS material_count,
       (SELECT count(*) FROM items WHERE item_type='personnel' AND is_active)::text AS personnel_count,
       (SELECT count(*) FROM suppliers WHERE is_active)::text AS supplier_count,
       (SELECT count(*) FROM prices WHERE status='active')::text AS price_count,
       (SELECT count(*) FROM prices WHERE status='active' AND effective_to IS NOT NULL
          AND effective_to >= $1::date AND effective_to <= ($1::date + 30))::text AS expiring_price_count,
       (SELECT count(*) FROM quotes WHERE status='draft' AND deleted_at IS NULL)::text AS draft_quote_count`,
    [todayStr],
  );
  const c = counts[0];

  const staleRow = await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM prices
      WHERE status='active'
        AND (effective_to IS NULL OR effective_to >= $1::date)
        AND ($1::date - GREATEST(updated_at, COALESCE(last_used_at, updated_at))::date) >= $2`,
    [todayStr, stale],
  );

  const monthRow = await q<{ total: string | null }>(
    `SELECT COALESCE(sum(total_price), 0)::text AS total FROM quotes
      WHERE status='issued' AND deleted_at IS NULL
        AND date_trunc('month', issued_at) = date_trunc('month', now())`,
  );

  const ratioRow = await q<{ manual: string; total: string }>(
    `SELECT count(*) FILTER (WHERE qi.cost_source='manual')::text AS manual, count(*)::text AS total
       FROM quote_items qi JOIN quotes q ON q.id = qi.quote_id
      WHERE q.created_at >= now() - INTERVAL '28 days' AND q.deleted_at IS NULL`,
  );

  const overdueRow = await q<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM quote_items qi
       JOIN quotes q ON q.id = qi.quote_id
       JOIN prices p ON p.id = qi.price_id
      WHERE q.status = 'issued'
        AND qi.cost_source = 'price_book'
        AND p.effective_to IS NOT NULL
        AND q.issued_at IS NOT NULL
        AND p.effective_to < q.issued_at::date`,
  );

  const recentPriceChanges = await q<{
    price_id: string;
    item_name: string;
    supplier_name: string;
    action: string;
    changed_by_name: string | null;
    changed_at: Date;
  }>(
    `SELECT l.price_id, i.name AS item_name, s.name AS supplier_name, l.action,
            u.name AS changed_by_name, l.changed_at
       FROM price_change_logs l
       JOIN prices p ON p.id = l.price_id
       JOIN items i ON i.id = p.item_id
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u ON u.id = l.changed_by
      ORDER BY l.changed_at DESC, l.id DESC
      LIMIT 10`,
  );

  // 最近报价单复用列表查询，保证列表页与工作台的字段口径完全一致
  const recent = await listQuotes({
    q: null,
    status: null,
    projectType: null,
    from: null,
    to: null,
    page: { page: 1, limit: 5, offset: 0 },
    orderBy: 'q.created_at DESC',
  });

  return {
    material_count: Number(c?.material_count ?? 0),
    personnel_count: Number(c?.personnel_count ?? 0),
    supplier_count: Number(c?.supplier_count ?? 0),
    price_count: Number(c?.price_count ?? 0),
    expiring_price_count: Number(c?.expiring_price_count ?? 0),
    draft_quote_count: Number(c?.draft_quote_count ?? 0),
    month_quote_total: monthRow[0]?.total ?? '0.00',
    stale_price_count: Number(staleRow[0]?.n ?? 0),
    manual_cost_line_ratio: ratioOf(ratioRow[0]),
    has_overdue_price: Number(overdueRow[0]?.n ?? 0) > 0,
    recent_quotes: recent.items,
    unread_notification_count: await unreadCount(userId),
    recent_price_changes: recentPriceChanges.map((r) => ({
      price_id: r.price_id,
      item_name: r.item_name,
      supplier_name: r.supplier_name,
      action: r.action,
      changed_by_name: r.changed_by_name,
      changed_at: r.changed_at.toISOString(),
      is_overwrite: r.action === 'superseded' || r.action === 'archived',
    })),
  };
}

function ratioOf(row: { manual: string; total: string } | undefined): string {
  const total = Number(row?.total ?? 0);
  if (total === 0) return '0.0000';
  return (Number(row?.manual ?? 0) / total).toFixed(4);
}
