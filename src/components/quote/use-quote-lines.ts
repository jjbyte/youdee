'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { api, errorMessage, isApiError } from '@/lib/api';
import { todayISO } from '@/lib/format';
import type { ItemDetail, ItemListItem, QuoteDetail, QuoteItem, RiskCheckResult } from '@/lib/types';
import { lineHasCost, linePatchBody, type SupplierPick } from './quote-shared';
import type { LineFlags } from './quote-line-row';

type Tone = 'success' | 'warn' | 'danger';
type ToastAction = { label: string; onClick: () => void };
type Say = (message: string, tone?: Tone, action?: ToastAction) => void;
/**
 * 执行一次写操作。
 *
 * **必须把成败交回调用方**：原来它 catch 住错误只 setError，调用方拿不到结果，
 * 于是"攒单"的按钮在自己的请求发出之前就弹了「已攒进 3 项」——
 * 服务端 400、一条都没进去，用户看到的是成功提示加一个原地不动的空列表。
 * 把结果 return 出去，UI 才有资格说"成功"。
 */
type Mutate = (fn: () => Promise<unknown>) => Promise<{ ok: boolean; message?: string }>;
export type AddResult = { added: number; message?: string };

/**
 * 报价单的行级操作（唯一出口）。
 *
 * 抽出来的原因不是为了少几行，是为了让「阻断规则」和「撤销语义」有两处可测的边界：
 * 页面只负责画，这里的每个函数都可以脱离 DOM 单独验。
 */
export function useQuoteLines({
  quote,
  risk,
  mutate,
  reload,
  say,
  undoMs,
}: {
  quote: QuoteDetail | null;
  risk: RiskCheckResult | null;
  mutate: Mutate;
  reload: () => Promise<void>;
  say: Say;
  undoMs: number;
}) {
  /** 移行请求串行化（见 moveLine 注释） */
  const pendingOrder = useRef<string[] | null>(null);
  const reorderBusy = useRef(false);

  const flagsOf = useCallback(
    (line: QuoteItem): LineFlags => {
      const idx = quote ? quote.items.findIndex((l) => l.id === line.id) : 0;
      const staleHit = (risk?.staleDraftItems ?? []).find(
        (s) => s.lineIndexes?.includes(idx + 1) || s.itemId === line.itemId,
      );
      const over =
        line.referenceLowestPrice && line.costUnitPrice
          ? (Number(line.costUnitPrice) - Number(line.referenceLowestPrice)) * Number(line.qty)
          : 0;
      return {
        missingCost: !lineHasCost(line),
        staleDays: staleHit ? 90 : undefined,
        overLowestAmount: over > 0 ? String(over.toFixed(2)) : undefined,
        loss: Number(line.lineProfit) < 0,
        zeroPrice: Number(line.saleUnitPrice) === 0,
      };
    },
    [quote, risk],
  );

  const missingCount = useMemo(
    () => (quote ? quote.items.filter((l) => !lineHasCost(l)).length : 0),
    [quote],
  );
  const staleCount = risk?.staleDraftItems.length ?? 0;
  const manualCount = quote ? quote.items.filter((l) => l.costSource === 'manual').length : 0;

  const lineById = useCallback(
    (lineId: string): QuoteItem | undefined => quote?.items.find((l) => l.id === lineId),
    [quote],
  );

  /**
   * 从选品抽屉攒进单子。逐条取价：
   *   - 取到了 → 带成本进单
   *   - 42205（本口径下没有有效价）→ **也进单**，但缺成本（行变红 + 手填入口）
   *     绝不静默拿旧价顶上，也绝不自动换口径——那两种"聪明"都会让报价员
   *     拿着一份看起来正常、实际错了的单子去见客户。
   *
   * `marginRate`（百分数，如 "40"）：单头还没有目标毛利率时由选品面板带上。
   * 对客价是成本按毛利率反推出来的，服务端拿不到毛利率就**整批拒绝**
   * （40001「无法反推」）——不先落这一笔，攒单在新单上一律失败。
   *
   * `picks`：选品面板里指定的「这一项用哪一家」。没指定就走价格库的默认取价。
   * 指定了就必须**按指定的那家取**——`/price-lookup` 早就支持 `supplier_id`，
   * 但界面从来没有传过它，于是"勾完再一家家去行上换供应商"成了必需动作。
   */
  const addItems = useCallback(
    async (
      items: ItemListItem[],
      marginRate?: string,
      picks?: Map<string, SupplierPick>,
    ): Promise<AddResult> => {
      if (!quote) return { added: 0, message: '报价单还没打开。' };

      // 单头的目标毛利率是反推对客价的唯一依据：先落库，再攒行
      if (marginRate) {
        const current = quote.targetMarginRate === null ? null : Number(quote.targetMarginRate);
        const want = Number(marginRate) / 100;
        if (current === null || Math.abs(current - want) > 1e-9) {
          const saved = await mutate(() => api.updateQuote(quote.id, { targetMarginRate: String(want) }));
          if (!saved.ok) return { added: 0, message: saved.message };
        }
      }

      const lines: Array<Record<string, unknown>> = [];
      const problems: string[] = [];
      for (const it of items) {
        const pick = picks?.get(it.id);
        const groups = it.lowestSummary?.groups ?? [];
        // 指定了供应商时，交易性质也一起定下了（两者是同一张价的属性，不能分开问）
        const nature =
          pick?.pricingNature ??
          (groups.length === 1 ? groups[0]!.pricingNature : it.itemType === 'personnel' ? 'service' : null);
        if (!nature) {
          // 0 组 = 一条价都没录；>1 组 = 同一主体有两种交易性质（租赁 / 买断），价格不能混。
          // 这两种都不猜：猜错的成本会被当成真的写进客户版。
          problems.push(
            groups.length === 0
              ? `${it.name} 还没有任何一条价，先去比价页录一条（或在那里手填成本）`
              : `${it.name} 有 ${groups.length} 种交易性质，在左边的「用哪家」里选一种再攒`,
          );
          continue;
        }
        // 参考价要取自**同一个性质**的组：选了买断却拿租赁的最低价当参照，
        // 行上那句「比最低高 ¥120」就是错的
        const refGroup = groups.find((g) => g.pricingNature === pick?.pricingNature) ?? groups[0];
        const base = {
          lineKind: it.itemType,
          pricingNature: nature,
          itemNameSnapshot: it.name,
          specSnapshot: it.spec,
          categorySnapshot: it.categoryName,
          // 单位跟成本单价同源：costUnitPrice 是 price-lookup 归一化到**比价单位**的价，
          // qty 也按比价单位填。这里若写基础单位，就会出现「¥177.78 / 套」而真值是每㎡
          // 177.78（一"套"是 18㎡）——差 18 倍，且看起来完全正常。
          unitSnapshot: it.compareUnitName || it.baseUnitName || it.baseUnitCode,
          qty: '1',
          itemId: it.id,
        };
        try {
          const look = await api.priceLookup({
            itemId: it.id,
            qty: '1',
            pricingNature: nature,
            // 本单口径只能从这张单自己身上读
            taxBasis: quote.taxStatement,
            onDate: quote.eventDate ?? todayISO(),
            supplierId: pick?.supplierId,
          });
          lines.push({
            ...base,
            costSource: 'price_book',
            costUnitPrice: look.baseUnitPrice,
            priceId: look.resolvedFrom.priceId,
            supplierId: look.resolvedFrom.supplierId,
            supplierNameSnapshot: look.resolvedFrom.supplierName,
            referenceLowestPrice: refGroup?.groupLowest ?? null,
            referenceLowestSupplierId: refGroup?.supplierId ?? null,
            sourceTierMinQty: look.resolvedFrom.tierMinQty,
            priceEffectiveFrom: look.resolvedFrom.effectiveFrom,
            priceEffectiveTo: look.resolvedFrom.effectiveTo,
          });
        } catch (e) {
          if (isApiError(e) && e.code === 42205) {
            lines.push({ ...base, costSource: 'price_book' });
            problems.push(
              pick
                ? `${it.name}：${pick.supplierName} 在本单口径下没有有效价，进单后手填成本`
                : `${it.name} 在本单口径下没有有效价，进单后手填成本`,
            );
          } else {
            problems.push(`${it.name}：${errorMessage(e)}`);
          }
        }
      }

      if (lines.length === 0) {
        const message = problems.join('；') || '一项都没攒进去。';
        say(message, 'danger');
        return { added: 0, message };
      }

      const res = await mutate(() => api.addQuoteItemsBulk(quote.id, lines));
      if (!res.ok) return { added: 0, message: res.message };

      if (problems.length > 0) {
        // 进了一部分：说清进了几行、哪几项没进，别只说"成功"
        const message = `${problems.length} 项没进去：${problems.join('；')}`;
        say(`攒了 ${lines.length} 行，${message}`, 'warn');
        return { added: lines.length, message };
      }
      return { added: lines.length };
    },
    [quote, mutate, say],
  );

  const deleteLine = useCallback(
    (line: QuoteItem) => {
      if (!quote) return;
      const snapshot = line;
      const ids = quote.items.map((l) => l.id);
      const index = ids.indexOf(line.id);
      void mutate(() => api.deleteQuoteItem(quote.id, line.id));
      // 撤销要放回**原来的位置**，不能追加到末尾。点了「撤销」却发现这行跑到最后，
      // 用户下次就不敢用撤销了——而撤销是让人敢按删除的唯一理由。
      say(`已删掉「${line.itemNameSnapshot}」，${undoMs / 1000} 秒内可撤销`, 'warn', {
        label: '撤销',
        onClick: () => {
          void mutate(async () => {
            const r = await api.addQuoteItem(
              quote.id,
              linePatchBody(snapshot, {
                costSource: snapshot.costSource,
                costUnitPrice: snapshot.costUnitPrice,
                saleUnitPrice: snapshot.saleUnitPrice,
                isVisibleToCustomer: snapshot.isVisibleToCustomer,
              }),
            );
            const order = [...ids];
            order.splice(index < 0 ? order.length : index, 0, r.item.id);
            await api.reorderQuoteItems(quote.id, order);
          });
        },
      });
    },
    [quote, mutate, say, undoMs],
  );

  /**
   * 移行。请求必须串起来：连按三下 Alt+↓，三个请求若并行，每个都基于同一个旧顺序算目标，
   * 最后落库的顺序取决于谁先返回，用户看到的是"按了三下只动了一格"。
   */
  const moveLine = useCallback(
    async (lineId: string, dir: -1 | 1) => {
      if (!quote) return;
      const base = pendingOrder.current ?? quote.items.map((l) => l.id);
      const i = base.indexOf(lineId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= base.length) return;
      const next = [...base];
      next[i] = base[j]!;
      next[j] = base[i]!;
      pendingOrder.current = next;
      if (reorderBusy.current) return;
      reorderBusy.current = true;
      try {
        while (pendingOrder.current) {
          const target = pendingOrder.current;
          pendingOrder.current = null;
          await api.reorderQuoteItems(quote.id, target);
        }
        await reload();
      } catch (e) {
        pendingOrder.current = null;
        say(errorMessage(e), 'danger');
      } finally {
        reorderBusy.current = false;
      }
    },
    [quote, reload, say],
  );

  const duplicateLine = useCallback(
    (line: QuoteItem) => {
      if (!quote) return;
      void mutate(() =>
        api.addQuoteItem(
          quote.id,
          linePatchBody(line, {
            qty: line.qty,
            costSource: line.costSource,
            costUnitPrice: line.costUnitPrice,
            saleUnitPrice: line.saleUnitPrice,
          }),
        ),
      );
    },
    [quote, mutate],
  );

  /**
   * 「按旧价重新录价」：就地补一条有效价，然后把这一行的成本换过去。
   * 不做成"跳到品页让用户自己回来"——那样他手上这张单就断了，
   * 回来还得自己找是哪一行、重新点成本格。断一次上下文，这单就半小时。
   */
  const [recreateItem, setRecreateItem] = useState<ItemDetail | null>(null);
  const recreateLine = useRef<QuoteItem | null>(null);

  const startRecreate = useCallback(
    async (line: QuoteItem) => {
      if (!line.itemId) {
        say('这行没有关联的品，成本只能手填。', 'warn');
        return;
      }
      recreateLine.current = line;
      try {
        setRecreateItem(await api.item(line.itemId));
      } catch (e) {
        recreateLine.current = null;
        say(errorMessage(e), 'danger');
      }
    },
    [say],
  );

  /** 新价存好后：按本单口径重新取一次价，取到就换到行上 */
  const afterRecreated = useCallback(async () => {
    const line = recreateLine.current;
    setRecreateItem(null);
    recreateLine.current = null;
    if (!quote || !line?.itemId || !line.pricingNature) return;
    try {
      const look = await api.priceLookup({
        itemId: line.itemId,
        qty: line.qty,
        pricingNature: line.pricingNature,
        taxBasis: quote.taxStatement,
        onDate: quote.eventDate ?? todayISO(),
      });
      await mutate(() =>
        api.updateQuoteItem(quote.id, line.id, {
          ...linePatchBody(line, { costSource: 'price_book', costUnitPrice: look.baseUnitPrice }),
          priceId: look.resolvedFrom.priceId,
          supplierId: look.resolvedFrom.supplierId,
          supplierNameSnapshot: look.resolvedFrom.supplierName,
        }),
      );
      say('新价录好了，这一行的成本已经换过来。');
    } catch (e) {
      say(`${errorMessage(e)}（价已经存进去了，这一行的成本还需要手动换一下）`, 'warn');
    }
  }, [quote, mutate, say]);

  return {
    flagsOf,
    missingCount,
    staleCount,
    manualCount,
    lineById,
    addItems,
    deleteLine,
    moveLine,
    duplicateLine,
    recreateItem,
    setRecreateItem,
    startRecreate,
    afterRecreated,
  };
}
