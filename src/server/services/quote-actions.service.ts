/**
 * 报价单动作：出单 / 作废 / 改版重报。
 *
 * 出单是一个原子动作，四件事必须同进同退（架构 §9.8）：
 *   ① 重算金额 ② 状态置 issued ③ 回写被引用价格的 last_used_at ④ 通知管理员
 * 其中 ④ 失败不回滚出单 —— 通知是"知道了更好"，出单是"业务已发生"。
 *
 * 草稿同步最新价在 quote-refresh.service：它改的是金额，风险等级与改价相同（仅 admin），
 * 与这里的状态流转不是同一类事。
 */

import { q, today, tx } from '../db';
import { AppError } from '../http';
import { calcLine } from '@/domain/quote-calc';
import { canDuplicate, canIssue, canRestore, canVoid } from '@/domain/quote-status';
import type { CurrentUser } from '../auth/session';
import {
  getQuoteRow,
  listQuoteItemRows,
  recalcAndPersist,
  type QuoteItemRow,
} from '../store/quotes.store';
import { staleDaysThreshold } from '../store/settings.store';
import { defaultUnitMode, resolveOne } from './lookup.service';
import { riskCheck } from './risk.service';
import { quoteDetail } from './quote.service';

export async function issueQuote(id: string) {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (!canIssue(quote.status as 'draft' | 'issued' | 'void')) {
    throw new AppError(
      40907,
      quote.status === 'issued' ? '这张单已经发出过了。' : '已作废的报价单不能再发出，请用「改版重报」。',
      409,
    );
  }
  const items = await listQuoteItemRows(id);
  if (items.length === 0) {
    throw new AppError(40906, '这张单还没有任何明细行，不能发出。', 409);
  }

  // 出单前强制跑一次自检：只有 blocker 拦人（客户名/活动名空、有行没成本）
  const check = await riskCheck(id);
  if (check.blocked) {
    throw new AppError(40001, check.blockers.map((b) => b.detail).join('；'), 400, {
      detail: { blockers: check.blockers },
    });
  }

  await tx(async (c) => {
    await recalcAndPersist(c, id);
    const r = await c.query(
      `UPDATE quotes SET status='issued', issued_at=now(), updated_at=now()
        WHERE id=$1 AND status='draft' RETURNING id`,
      [id],
    );
    if (r.rowCount === 0) {
      throw new AppError(40907, '这张单刚刚被发出或作废了，请刷新后重试。', 409);
    }
    // 软陈旧计时重置。**绝不顺带更新 updated_at** —— 那会让每笔出单都显示成"价格被修改过"。
    await c.query(
      `UPDATE prices p SET last_used_at = now()
         FROM quote_items qi
        WHERE qi.quote_id = $1 AND qi.price_id = p.id
          AND (p.last_used_at IS NULL OR p.last_used_at < now())`,
      [id],
    );
  });

  // 通知：commit 之后再写，写失败只记日志（不把已发生的出单回滚掉）
  try {
    await notifyIssued(id, quote.quote_no, quote.customer_name, quote.total_price, quote.margin_rate);
  } catch (e) {
    console.error('[quote] 出单通知写入失败（出单已成功）', e);
  }
  return quoteDetail(id);
}

async function notifyIssued(
  quoteId: string,
  quoteNo: string,
  customerName: string,
  totalPrice: string,
  marginRate: string,
): Promise<void> {
  const margin = `${(Number(marginRate) * 100).toFixed(1)}%`;
  await q(
    `INSERT INTO notifications (user_id, type, title, body, quote_id)
     SELECT u.id, 'quote_issued', $2, $3, $1
       FROM users u WHERE u.role = 'admin' AND u.is_active`,
    [quoteId, `报价单 ${quoteNo} 已发出`, `客户：${customerName}；金额 ${totalPrice}；毛利率 ${margin}`],
  );
}

export async function voidQuote(id: string, reason: string | null) {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (!canVoid(quote.status as 'draft' | 'issued' | 'void')) {
    throw new AppError(40907, '这张单已经作废过了。', 409);
  }
  await q(
    `UPDATE quotes
        SET status='void', note = CASE WHEN $2::text IS NULL THEN note ELSE concat_ws(E'\n', note, $2) END,
            updated_at = now()
      WHERE id=$1`,
    [id, reason ? `作废原因：${reason}` : null],
  );
  return quoteDetail(id);
}

/**
 * 撤销作废（成员可用）。
 *
 * 回到哪个状态**看 issued_at，不看调用方**：
 *   有出单时间 = 这单真的发给过客户，恢复成「已发出」才是它的本来面目；
 *   没有出单时间 = 它本来就是草稿，恢复成草稿继续编。
 * 不能一律回到 issued：那样一张被作废的空草稿会变成"已发出但零行"，
 * 而列表里再点进去看到的是客户版预览——一个空白的客户版。
 */
export async function restoreQuote(id: string) {
  const quote = await getQuoteRow(id);
  if (!quote) throw new AppError(40401, '这张报价单不存在。', 404);
  if (!canRestore(quote.status as 'draft' | 'issued' | 'void')) {
    throw new AppError(40907, '只有已作废的报价单可以恢复。', 409);
  }
  const backTo = quote.issued_at ? 'issued' : 'draft';
  await q('UPDATE quotes SET status=$2, updated_at=now() WHERE id=$1', [id, backTo]);
  return quoteDetail(id);
}

/** 改版重报：旧版冻结，新版本是草稿。单号不变、version+1 */
export async function newVersion(id: string, copyItems: boolean) {
  const source = await getQuoteRow(id);
  if (!source) throw new AppError(40401, '这张报价单不存在。', 404);
  if (!canDuplicate(source.status as 'draft' | 'issued' | 'void')) {
    throw new AppError(40907, '草稿可以直接编辑，不需要改版。只有已发出或已作废的单才做改版。', 409);
  }
  const items = await listQuoteItemRows(id);
  const newId = await tx(async (c) => {
    const maxRow = await c.query<{ v: number }>(
      'SELECT COALESCE(max(version), 1) AS v FROM quotes WHERE quote_no = $1',
      [source.quote_no],
    );
    const version = Number(maxRow.rows[0]?.v ?? 1) + 1;
    const r = await c.query<{ id: string }>(
      `INSERT INTO quotes (quote_no, version, derived_from_quote_id, customer_name, event_name, event_date,
                           valid_until, status, project_type, currency, target_margin_rate, discount_amount,
                           total_cost, total_price, total_profit, margin_rate, min_line_margin,
                           tax_statement, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,0,0,0,0,NULL,$12,$13,$14)
       RETURNING id`,
      [
        source.quote_no,
        version,
        source.id,
        source.customer_name,
        source.event_name,
        source.event_date,
        source.valid_until,
        source.project_type,
        source.currency,
        source.target_margin_rate,
        source.discount_amount,
        source.tax_statement,
        source.note,
        source.created_by,
      ],
    );
    const created = r.rows[0]!.id;
    if (copyItems) {
      for (const row of items) {
        await c.query(
          `INSERT INTO quote_items (quote_id, sort_order, line_kind, pricing_nature, item_name_snapshot,
             spec_snapshot, category_snapshot, unit_snapshot, supplier_name_snapshot, qty, cost_unit_price,
             sale_unit_price, line_cost, line_price, line_profit, line_margin, cost_source, price_missing,
             reference_lowest_price, reference_lowest_supplier_id, tax_included, item_id, price_id, supplier_id,
             is_visible_to_customer, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
          [
            created,
            row.sort_order,
            row.line_kind,
            row.pricing_nature,
            row.item_name_snapshot,
            row.spec_snapshot,
            row.category_snapshot,
            row.unit_snapshot,
            row.supplier_name_snapshot,
            row.qty,
            row.cost_unit_price,
            row.sale_unit_price,
            row.line_cost,
            row.line_price,
            row.line_profit,
            row.line_margin,
            row.cost_source,
            row.price_missing,
            row.reference_lowest_price,
            row.reference_lowest_supplier_id,
            row.tax_included,
            row.item_id,
            row.price_id,
            row.supplier_id,
            row.is_visible_to_customer,
            row.note,
          ],
        );
      }
      await recalcAndPersist(c, created);
    }
    return created;
  });
  return quoteDetail(newId);
}
