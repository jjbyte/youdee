'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cx, formatMoney } from '@/lib/format';
import type { Category, ItemListItem } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, SearchInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { InlineLoading } from '@/components/ui/states';
import { IconPlus, IconQuote } from '@/components/icons';
import { marginToMultiplier, parsePercentInput } from './quote-shared';

/**
 * 左侧选品抽屉（§C.7，320px）。
 *
 * 空态文案照抄 §D.5：`单子还是空的。左边搜「背景板」试试，勾上点「攒进报价单」。`
 * 勾选是**跨搜索保留**的——搜一次加一批是这个页面的主循环，
 * 清空勾选等于让用户每加两个物料就重搜一次。
 *
 * 三件容易做错、都放在这里的：
 *   ① **成功提示必须等请求回来再说**。攒单要逐条取价再批量写行，几百毫秒；
 *      先弹「已攒进 3 项」、再去发请求，一旦服务端拒绝（比如本单没有目标毛利率），
 *      用户看到的就是"提示成功、列表空着"，而勾选已经被清掉了。
 *   ② **失败不清勾选**。清掉的代价是他要重新搜一遍、重新勾一遍。
 *   ③ 对客价是按毛利率反推的，所以**毛利率必须在攒单选品时就能填**——
 *      它和按钮就并排站在一起（§C.6 摘要条同款排法），不是藏在单头里等人自己去找。
 */
export function PickerPanel({
  disabled,
  marginRate,
  onAdd,
  onToast,
}: {
  disabled: boolean;
  /** 单头当前的目标毛利率（0–1），没设就是 null */
  marginRate: number | null;
  /** 返回真正进单的行数；抛错/added=0 都按失败处理 */
  onAdd: (items: ItemListItem[], marginRate: string) => Promise<{ added: number; message?: string }>;
  onToast: (message: string, tone: 'success' | 'warn' | 'danger') => void;
}) {
  const [itemType, setItemType] = useState<'material' | 'personnel'>('material');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ItemListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<Map<string, ItemListItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [marginDraft, setMarginDraft] = useState(
    marginRate ? String(Math.round(marginRate * 1000) / 10) : '',
  );

  // 单头的毛利率被改过（别处 patch 成功、或撤回了），这里跟着走
  useEffect(() => {
    setMarginDraft(marginRate ? String(Math.round(marginRate * 1000) / 10) : '');
  }, [marginRate]);

  useEffect(() => {
    api
      .categories(itemType)
      .then((c) => setCategories(Array.isArray(c) ? c : (c[itemType] ?? [])))
      .catch(() => setCategories([]));
  }, [itemType]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListError(null);
    const timer = window.setTimeout(() => {
      api
        .items({ itemType, q: q.trim() || undefined, categoryId: categoryId || undefined, limit: 30 })
        .then((p) => alive && setRows(p.items ?? []))
        .catch((e) => alive && setListError(errorMessage(e)))
        .finally(() => alive && setLoading(false));
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [itemType, q, categoryId]);

  function toggle(item: ItemListItem) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  const pickedList = Array.from(picked.values());
  const rate = parsePercentInput(marginDraft);
  const rateOk = rate !== null && rate > 0 && rate < 1;

  async function submit() {
    if (pickedList.length === 0) return;
    // 对客价 = 成本 ÷ (1 − 毛利率)。没有毛利率就没有对客价，服务端会整批拒绝——
    // 所以在这里拦住，说清楚要填什么，而不是发出去等一个 400。
    if (!rateOk) {
      setSubmitError('先填目标毛利率（1–99），对客价要按它反推。');
      return;
    }
    setAdding(true);
    setSubmitError(null);
    try {
      const r = await onAdd(pickedList, String(Math.round(rate * 1000) / 10));
      if (r.added > 0) {
        setPicked(new Map());
        onToast(`已攒进 ${r.added} 项`, 'success');
        if (r.message) onToast(`已攒进 ${r.added} 项；${r.message}`, 'warn');
      } else {
        // 一项都没进去：勾选留着，原因写在按钮上方（toast 会飘走，原因得留在原地）
        setSubmitError(r.message ?? '一项都没攒进去。');
      }
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside className="editor__aside" aria-label="选品">
      {/* data-picker-search 是给「＋ 添加行」用的：那个按钮的真实动作就是把光标送进搜索框，
          而不是把人踢到另一个页面去找——找回来还得重新定位这张单 */}
      <div data-picker-search>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="搜物料 / 人员"
          ariaLabel="搜索物料或人员"
        />
      </div>

      <Segmented<'material' | 'personnel'>
        ariaLabel="主体类型"
        value={itemType}
        options={[
          { value: 'material', label: '物料' },
          { value: 'personnel', label: '人员' },
        ]}
        onChange={(v) => {
          setItemType(v);
          setCategoryId('');
        }}
      />

      {categories.length > 0 ? (
        // 分类多的时候自己滚，别把中间的列表和底部的按钮挤没
        <div className="flex flex-col gap-[var(--space-1)] overflow-auto" style={{ maxHeight: '45%' }}>
          <button
            type="button"
            className={cx('chip', categoryId === '' && 'chip--on')}
            aria-pressed={categoryId === ''}
            onClick={() => setCategoryId('')}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx('chip', categoryId === c.id && 'chip--on')}
              aria-pressed={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
            >
              <span className="truncate">{c.name}</span>
              {typeof c.itemCount === 'number' ? <span className="num t-3 ml-auto">{c.itemCount}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-[var(--space-2)]">
        {loading ? <InlineLoading label="正在找…" /> : null}
        {!loading && listError ? <div className="t-xs t-danger">{listError}</div> : null}
        {!loading && !listError && rows.length === 0 ? (
          <div className="t-xs t-3">
            {q ? `没找到「${q}」。换个说法试试，或者去库里新建。` : '这一类还没有主体。'}
          </div>
        ) : null}
        {rows.map((it) => {
          const on = picked.has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              className={cx('panel w-full text-left', on && 'ring-1 ring-[var(--accent-border)]')}
              aria-pressed={on}
              onClick={() => toggle(it)}
            >
              <div className="flex items-start gap-[var(--space-2)]">
                <div className="min-w-0 flex-1">
                  <div className="t-sm truncate">{it.name}</div>
                  <div className="t-2xs t-3 truncate">
                    {it.spec ?? it.categoryName}
                    {it.priceSupplierCount > 0 ? ` · ${it.priceSupplierCount} 家报价` : ' · 还没录价'}
                  </div>
                </div>
                {on ? <Badge tone="success">已勾</Badge> : <IconPlus size={16} className="t-3" />}
              </div>
              {it.lowestSummary?.groups?.length ? (
                <div className="t-2xs t-3 mt-[var(--space-1)]">
                  {it.lowestSummary.groups.map((g, gi) => (
                    <span key={`${it.id}-g${gi}`}>
                      {gi > 0 ? ' · ' : ''}
                      最低 <span className="num">{formatMoney(g.groupLowest)}</span>/{g.unitCode}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-[var(--space-2)] pt-[var(--space-3)] border-t border-[var(--border)]">
        {/* 勾选数与毛利率同一行：这栏的高度是列表的空间，能省一行就省一行。
            毛利率挨着按钮放——对客价是它反推出来的，填它的地方就该在点按钮的地方。 */}
        <div className="flex items-center justify-between gap-[var(--space-2)]">
          <span className="t-2xs t-3">
            已勾选 <span className="num">{pickedList.length}</span> 项
          </span>
          <label className="flex items-center gap-[var(--space-1)]" title="对客价 = 成本 ÷ (1 − 毛利率)">
            <span className="t-2xs t-3">
              毛利率
              {/* 只有填了有效值才显示倍率：空着的时候显示「×( — )」是一句废话 */}
              {rateOk ? <span className="num"> ×{marginToMultiplier(rate!)}</span> : null}
            </span>
            <Input
              className="num"
              inputMode="decimal"
              aria-label="目标毛利率（百分比）"
              value={marginDraft}
              onChange={(e) => setMarginDraft(e.target.value)}
              placeholder="40"
              style={{ width: 52, textAlign: 'right' }}
            />
            <span className="t-2xs t-3">%</span>
          </label>
        </div>
        {submitError ? (
          <div className="t-2xs t-danger" role="alert">
            {submitError}
          </div>
        ) : null}
        <Button
          variant="primary"
          block
          icon={<IconQuote size={16} />}
          loading={adding}
          disabled={disabled || pickedList.length === 0}
          onClick={() => void submit()}
        >
          攒进报价单
        </Button>
      </div>
    </aside>
  );
}
