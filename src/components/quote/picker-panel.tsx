'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cx, formatMoney } from '@/lib/format';
import type { Category, ItemListItem } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { InlineLoading } from '@/components/ui/states';
import { IconPlus, IconQuote } from '@/components/icons';

/**
 * 左侧选品抽屉（§C.7，320px）。
 *
 * 空态文案照抄 §D.5：`单子还是空的。左边搜「背景板」试试，勾上点「攒进报价单」。`
 * 勾选是**跨搜索保留**的——搜一次加一批是这个页面的主循环，
 * 清空勾选等于让用户每加两个物料就重搜一次。
 */
export function PickerPanel({
  disabled,
  onAdd,
  onToast,
}: {
  disabled: boolean;
  onAdd: (items: ItemListItem[]) => void;
  onToast: (message: string) => void;
}) {
  const [itemType, setItemType] = useState<'material' | 'personnel'>('material');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ItemListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<Map<string, ItemListItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .categories(itemType)
      .then((c) => setCategories(Array.isArray(c) ? c : (c[itemType] ?? [])))
      .catch(() => setCategories([]));
  }, [itemType]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api
        .items({ itemType, q: q.trim() || undefined, categoryId: categoryId || undefined, limit: 30 })
        .then((p) => alive && setRows(p.items ?? []))
        .catch((e) => alive && setError(errorMessage(e)))
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
        <div className="flex flex-col gap-[var(--space-1)]">
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
        {error ? <div className="t-xs t-danger">{error}</div> : null}
        {!loading && !error && rows.length === 0 ? (
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
        <span className="t-2xs t-3">
          已勾选 <span className="num">{pickedList.length}</span> 项
        </span>
        <Button
          variant="primary"
          block
          icon={<IconQuote size={16} />}
          disabled={disabled || pickedList.length === 0}
          onClick={() => {
            onAdd(pickedList);
            setPicked(new Map());
            onToast(`已把 ${pickedList.length} 项攒进报价单`);
          }}
        >
          攒进报价单
        </Button>
      </div>
    </aside>
  );
}
