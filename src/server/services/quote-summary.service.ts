/**
 * 报价单台账统计。
 *
 * 放在服务端而不是前端：by_project_type 要 JOIN margin_thresholds 才能带出
 * 每个类型的预警线与"低于预警线的单数"，前端手里没有阈值表。
 */
import { q } from '../db';
import { marginRate, parseAmount } from '@/domain/money';
import { marginThresholds, getSetting } from '../store/settings.store';

export interface QuoteSummaryQuery {
  from: string | null;
  to: string | null;
  groupBy: 'project_type' | 'status' | null;
}

export async function quotesSummary(query: QuoteSummaryQuery) {
  const parts = ["deleted_at IS NULL", "status IN ('issued','void')"];
  const params: unknown[] = [];
  if (query.from) {
    params.push(query.from);
    parts.push(`created_at::date >= $${params.length}::date`);
  }
  if (query.to) {
    params.push(query.to);
    parts.push(`created_at::date <= $${params.length}::date`);
  }
  const where = `WHERE ${parts.join(' AND ')}`;

  const head = await q<{
    quote_count: string;
    total_price: string;
    total_profit: string;
  }>(
    `SELECT count(*)::text AS quote_count,
            COALESCE(sum(total_price), 0)::text AS total_price,
            COALESCE(sum(total_profit), 0)::text AS total_profit
       FROM quotes ${where}`,
    params,
  );
  const h = head[0];
  const totalPrice = h?.total_price ?? '0';
  const totalProfit = h?.total_profit ?? '0';
  // 毛利率用定点整除算：整单金额过十万后 Number() 会丢分，台账正是看大数的地方
  const avg = marginRate(parseAmount(totalProfit), parseAmount(totalPrice));

  const byStatusRows = await q<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM quotes ${where} GROUP BY status`,
    params,
  );
  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = Number(r.n);

  const topRows = await q<{ customer_name: string; quote_count: string; total_price: string }>(
    `SELECT customer_name, count(*)::text AS quote_count, COALESCE(sum(total_price),0)::text AS total_price
       FROM quotes ${where}
      GROUP BY customer_name
      ORDER BY sum(total_price) DESC
      LIMIT 5`,
    params,
  );

  const result: Record<string, unknown> = {
    quote_count: Number(h?.quote_count ?? 0),
    total_price: totalPrice,
    total_profit: totalProfit,
    avg_margin_rate: avg === null ? '0.0000' : avg.toFixed(4),
    by_status: byStatus,
    top_customers: topRows.map((r) => ({
      customer_name: r.customer_name,
      quote_count: Number(r.quote_count),
      total_price: r.total_price,
    })),
  };

  if (query.groupBy === 'project_type') {
    const rows = await q<{
      project_type: string | null;
      quote_count: string;
      total_price: string;
      total_profit: string;
    }>(
      `SELECT project_type, count(*)::text AS quote_count,
              COALESCE(sum(total_price),0)::text AS total_price,
              COALESCE(sum(total_profit),0)::text AS total_profit
         FROM quotes ${where}
        GROUP BY project_type
        ORDER BY project_type NULLS LAST`,
      params,
    );
    const thresholds = await marginThresholds();
    const byType = new Map(thresholds.map((t) => [t.project_type, Number(t.warn_rate)]));
    const globalDefault = Number(await getSetting<number>('default_margin_threshold', 0.25));

    result.by_project_type = rows.map((r) => {
      const m = marginRate(parseAmount(r.total_profit), parseAmount(r.total_price));
      const warn = r.project_type ? byType.get(r.project_type) ?? globalDefault : globalDefault;
      return {
        project_type: r.project_type,
        quote_count: Number(r.quote_count),
        total_price: r.total_price,
        total_profit: r.total_profit,
        avg_margin_rate: m === null ? '0.0000' : m.toFixed(4),
        warn_rate: warn.toFixed(4),
        below_warn_count: m !== null && m < warn ? Number(r.quote_count) : 0,
      };
    });
  }
  return result;
}
