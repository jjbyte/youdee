'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cx, formatMoney } from '@/lib/format';
import { natureLabel, unitLabel } from '@/lib/labels';
import type { Category, CompareGroup, ItemListItem, PricingNature, TaxBasis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, SearchInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { InlineLoading } from '@/components/ui/states';
import { IconPlus, IconQuote } from '@/components/icons';
import { rankRows } from '@/lib/compare-local';
import { marginToMultiplier, parsePercentInput, type SupplierPick } from './quote-shared';

/** 一个物料在本单口径下能选的那几条价（已经过滤掉不可比的） */
interface Offer {
  loading: boolean;
  groups: CompareGroup[];
  /** 比价单位。下拉里的价钱统一按它说话——进单的成本就是按这个单位归一化后的数，
      显示原始单位（「¥3,200/套」）会让人以为进单也是 3200 */
  unitCode: string;
  error?: string;
}

/**
 * 左侧选品抽屉（§C.7，320px）。
 *
 * 空态文案照抄 §D.5：`单子还是空的。左边搜「背景板」试试，勾上点「攒进报价单」。`
 * 勾选是**跨搜索保留**的——搜一次加一批是这个页面的主循环，
 * 清空勾选等于让用户每加两个物料就重搜一次。
 *
 * 四件容易做错、都放在这里的：
 *   ① **成功提示必须等请求回来再说**。攒单要逐条取价再批量写行，几百毫秒；
 *      先弹「已攒进 3 项」、再去发请求，一旦服务端拒绝（比如本单没有目标毛利率），
 *      用户看到的就是"提示成功、列表空着"，而勾选已经被清掉了。
 *   ② **失败不清勾选**。清掉的代价是他要重新搜一遍、重新勾一遍。
 *   ③ 对客价是按毛利率反推的，所以**毛利率必须在攒单选品时就能填**——
 *      它和按钮就并排站在一起（§C.6 摘要条同款排法），不是藏在单头里等人自己去找。
 *   ④ **勾上之后要能指定用哪一家**。价格库按"同性质同口径里最便宜"取价，但便宜的
 *      那家可能做不出来、交不了期、或者上次惹过客户——这是商务判断，系统不能替。
 *      所以勾选行自带「用哪家」，默认仍是价格库的结果（`自动`），改了就按改的取。
 *      一家家把供应商选择搬到行上再点成本格，等于让人勾完再回头挨个改一遍。
 */
export function PickerPanel({
  disabled,
  marginRate,
  taxBasis,
  eventDate,
  onAdd,
  onToast,
}: {
  disabled: boolean;
  /** 单头当前的目标毛利率（0–1），没设就是 null */
  marginRate: number | null;
  /** 本单口径：选供应商时按它判"这条价能不能进这张单" */
  taxBasis: TaxBasis;
  /** 取价基准日（活动日）。不传就是今天 */
  eventDate?: string | null;
  /** 返回真正进单的行数；抛错/added=0 都按失败处理 */
  onAdd: (
    items: ItemListItem[],
    marginRate: string,
    picks: Map<string, SupplierPick>,
  ) => Promise<{ added: number; message?: string }>;
  onToast: (message: string, tone: 'success' | 'warn' | 'danger') => void;
}) {
  const [itemType, setItemType] = useState<'material' | 'personnel'>('material');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ItemListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<Map<string, ItemListItem>>(new Map());
  const [picks, setPicks] = useState<Map<string, SupplierPick>>(new Map());
  /** 已勾选总览（默认收起：面板高度是稀缺资源） */
  const [showPicked, setShowPicked] = useState(false);
  const [offers, setOffers] = useState<Map<string, Offer>>(new Map());
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

  // 口径换了就是另一套价：已经拉到的候选全部作废，否则会把含税的价当作不含税的用
  useEffect(() => {
    setOffers(new Map());
    setPicks(new Map());
  }, [taxBasis]);

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

  /** 勾上才去问这家的价：没勾的物料一条请求都不发（一屏 30 个，问不起） */
  async function loadOffer(item: ItemListItem) {
    if (offers.has(item.id)) return;
    if (!item.priceSupplierCount) return; // 一条价都没有，问也是空
    setOffers((prev) => new Map(prev).set(item.id, { loading: true, groups: [], unitCode: '' }));
    try {
      const r = await api.compare(item.id, {
        qty: '1',
        taxBasis,
        onDate: eventDate ?? undefined,
      });
      setOffers((prev) =>
        new Map(prev).set(item.id, {
          loading: false,
          groups: r.groups ?? [],
          unitCode: r.item.compareUnitCode ?? r.item.baseUnitCode,
        }),
      );
    } catch (e) {
      setOffers((prev) =>
        new Map(prev).set(item.id, { loading: false, groups: [], unitCode: '', error: errorMessage(e) }),
      );
    }
  }

  function toggle(item: ItemListItem) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
        // 取消勾选时把"选了谁"一起扔掉：再勾回来应该是价格库的默认取价，
        // 而不是几分钟前在这个位置留下的旧选择
        setPicks((p) => {
          if (!p.has(item.id)) return p;
          const q2 = new Map(p);
          q2.delete(item.id);
          return q2;
        });
      } else {
        next.set(item.id, item);
        void loadOffer(item);
      }
      return next;
    });
  }

  const pickedList = Array.from(picked.values());
  const rate = parsePercentInput(marginDraft);
  const rateOk = rate !== null && rate > 0 && rate < 1;

  /**
   * 交给攒单的「用哪家」。
   *
   * **不替用户补默认**：多性质物料（租赁 / 买断）选哪个是一笔商务判断，
   * 系统猜错会被当成真的写进客户版——所以下拉第一项写的是「请选一种」而不是「自动」，
   * 没选就被拦在攒单前，提示还留在按钮上方。
   */
  function effectivePicks(): Map<string, SupplierPick> {
    return new Map(picks);
  }

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
      const r = await onAdd(pickedList, String(Math.round(rate * 1000) / 10), effectivePicks());
      if (r.added > 0) {
        setPicked(new Map());
        setPicks(new Map());
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
        /* 分类**横着排一行**、自己横滚。
           原来纵向铺开：8 个分类吃掉 250px，320px 宽的选品栏只剩 90px 给物料列表——
           一屏一张卡片，勾两个物料要滚三次。信息一个没少，只是换了个方向。 */
        <div className="flex gap-[var(--space-1)] overflow-x-auto shrink-0 pb-[2px]" style={{ minHeight: 0 }}>
          <button
            type="button"
            className={cx('chip shrink-0', categoryId === '' && 'chip--on')}
            aria-pressed={categoryId === ''}
            onClick={() => setCategoryId('')}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx('chip shrink-0', categoryId === c.id && 'chip--on')}
              aria-pressed={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
            >
              <span>{c.name}</span>
              {typeof c.itemCount === 'number' ? <span className="num t-3">{c.itemCount}</span> : null}
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
            /* 卡片用 div 而不是 button：勾上之后它自己要装一个 <select>，
               而 button 里套 select 是非法嵌套，点了控件还会连带把卡片再切一次。
               键盘可达性靠 tabIndex + Enter/Space 自己补回来。 */
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              className={cx('panel w-full text-left cursor-pointer', on && 'ring-1 ring-[var(--accent-border)]')}
              aria-pressed={on}
              onClick={() => toggle(it)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(it);
                }
              }}
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
                      最低 <span className="num">{formatMoney(g.groupLowest)}</span>/
                      {unitLabel(g.unitCode)}
                    </span>
                  ))}
                </div>
              ) : null}
              {/* 「用哪家」就地长在勾中的卡片里：不额外占面板高度（这栏只有 480px，
                  分类 + 列表 + 按钮已经把它分完了），也让人一眼看到"这一项会用谁" */}
              {on ? (
                <div onClick={(e) => e.stopPropagation()} className="mt-[var(--space-2)]">
                  <PickedRow
                    item={it}
                    offer={offers.get(it.id)}
                    pick={picks.get(it.id)}
                    taxBasis={taxBasis}
                    onPick={(p) =>
                      setPicks((prev) => {
                        const next = new Map(prev);
                        if (p) next.set(it.id, p);
                        else next.delete(it.id);
                        return next;
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* 换过搜索词以后，之前勾的物料已经不在列表里了——卡片内联的「用哪家」跟着消失，
          但勾选还在、攒单还会带上它。所以给一个总览入口：默认收起（这栏只有 480px），
          点开才占高度，里面能核对"勾了哪几项、每项用谁"。 */}
      {pickedList.length > 0 && showPicked ? (
        <div className="flex flex-col gap-[var(--space-1)] border-t border-[var(--border)] pt-[var(--space-2)] max-h-[132px] overflow-auto">
          {pickedList.map((it) => (
            <PickedRow
              key={it.id}
              item={it}
              offer={offers.get(it.id)}
              pick={picks.get(it.id)}
              taxBasis={taxBasis}
              showName
              onPick={(p) =>
                setPicks((prev) => {
                  const next = new Map(prev);
                  if (p) next.set(it.id, p);
                  else next.delete(it.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-[var(--space-2)] pt-[var(--space-3)] border-t border-[var(--border)]">
        {/* 勾选数与毛利率同一行：这栏的高度是列表的空间，能省一行就省一行。
            毛利率挨着按钮放——对客价是它反推出来的，填它的地方就该在点按钮的地方。 */}
        <div className="flex items-center justify-between gap-[var(--space-2)]">
          {pickedList.length > 0 ? (
            <button
              type="button"
              className="btn btn--link t-2xs"
              aria-expanded={showPicked}
              onClick={() => setShowPicked((v) => !v)}
            >
              已勾选 <span className="num">{pickedList.length}</span> 项 · {showPicked ? '收起' : '看用谁'}
            </button>
          ) : (
            <span className="t-2xs t-3">
              已勾选 <span className="num">0</span> 项
            </span>
          )}
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

/**
 * 一个已勾选的物料 + 它的供应商选择。
 *
 * 四种形态，都是为了让"这次会用谁"这句话在勾选后立刻成立：
 *   · 一条价都没录 → 直说"还没录价，进单后手填成本"（不给一个空下拉让人点）
 *   · 只有一家、一种性质 → 直接写名字和价钱（下拉里只有一项是假的可选）
 *   · 同一性质多家 → 下拉，默认「自动」= 价格库怎么取就怎么取，改了就按改的取
 *   · 多种性质（租赁/买断）→ 下拉默认「选一种」且**不给默认值**：买还是租是商务判断，
 *     系统猜错的成本会被当成真的写进客户版
 */
function PickedRow({
  item,
  offer,
  pick,
  taxBasis,
  showName = false,
  onPick,
}: {
  item: ItemListItem;
  offer: Offer | undefined;
  pick: SupplierPick | undefined;
  taxBasis: TaxBasis;
  /** 在总览清单里渲染时要带上物料名（在列表卡片里则不必，卡片上方已经写着了） */
  showName?: boolean;
  onPick: (pick: SupplierPick | null) => void;
}) {
  const groupCount = offer?.groups.length ?? 0;
  const options = (offer?.groups ?? []).flatMap((g) =>
    rankRows(g.rows, taxBasis, 1)
      .filter((r) => r.exclusive === null)
      .map((r) => ({
        nature: g.pricingNature,
        priceId: r.row.priceId,
        supplierId: r.row.supplierId,
        supplierName: r.row.supplierName,
        unit: unitLabel(offer?.unitCode, r.row.unitCode),
        price: r.hit.baseUnitPrice ?? r.hit.unitPrice ?? 0,
        groupCount,
      })),
  );

  const value = pick ? `${pick.pricingNature}|${pick.priceId}` : '';
  /** 多种性质还没选：攒单会被拒，这里先把它标出来，别等到点了按钮才知道 */
  const needPick = groupCount > 1 && !pick;

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      {showName ? (
        <span className="t-2xs truncate" style={{ flex: '0 0 38%', minWidth: 0 }} title={item.name}>
          {item.name}
        </span>
      ) : (
        <span className="t-2xs t-3 shrink-0">用哪家</span>
      )}
      {!item.priceSupplierCount ? (
        <span className="t-2xs t-3">还没录价，进单后手填成本</span>
      ) : offer?.loading ? (
        <span className="t-2xs t-3">问价中…</span>
      ) : offer?.error ? (
        <span className="t-2xs t-danger" title={offer.error}>
          价读不出来
        </span>
      ) : options.length === 0 ? (
        <span className="t-2xs t-warn" title="这个物料在本单口径下没有能用的价，进单后手填成本">
          本口径无可用价
        </span>
      ) : options.length === 1 && groupCount <= 1 ? (
        // 只有一家：写成文字而不是"下拉里唯一的一项"，省一次点击也省一次误解
        <span className="t-2xs truncate" title={`${options[0]!.supplierName} ¥${options[0]!.price}`}>
          {options[0]!.supplierName} <span className="num">¥{formatMoney(options[0]!.price)}</span>
          <span className="t-3">/{options[0]!.unit}</span>
        </span>
      ) : (
        <select
          className="select t-2xs"
          aria-label={`${item.name} 用哪一家`}
          aria-invalid={needPick || undefined}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              onPick(null);
              return;
            }
            const [nature, priceId] = v.split('|');
            const hit = options.find((o) => `${o.nature}|${o.priceId}` === v);
            if (!hit || !priceId) return;
            onPick({
              pricingNature: hit.nature,
              priceId,
              supplierId: hit.supplierId,
              supplierName: hit.supplierName,
            });
          }}
          style={{
            flex: '1 1 50%',
            minWidth: 0,
            height: 26,
            paddingLeft: 6,
            paddingRight: 16,
            fontSize: 11,
            ...(needPick ? { borderColor: 'var(--danger)' } : null),
          }}
        >
          {groupCount > 1 ? (
            <option value="">选一种（共 {groupCount} 种性质）</option>
          ) : (
            /* 默认项不是"系统替你决定"，而是"价格库按规则取的那一家" */
            <option value="">
              自动（{options[0] ? `${options[0].supplierName} ¥${formatMoney(options[0].price)}/${options[0].unit}` : autoLabel(item)}）
            </option>
          )}
          {options.map((o) => (
            <option key={`${o.nature}|${o.priceId}`} value={`${o.nature}|${o.priceId}`}>
              {`${naturePrefix(o.nature, o.groupCount)}${o.supplierName} ¥${formatMoney(o.price)}/${o.unit}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** 只有一种性质时不啰嗦，多种才在选项前面带上性质——否则每个选项前面都挂着同一个词 */
function naturePrefix(nature: PricingNature, groupCount: number): string {
  if (groupCount <= 1) return '';
  return `${natureLabel(nature)} · `;
}

/** 「自动」到底会取到哪家——用列表里带过来的最低价快照说清楚，不让人猜 */
function autoLabel(item: ItemListItem): string {
  const g = item.lowestSummary?.groups?.[0];
  if (!g) return '按价格库取价';
  return `${g.supplierName ?? '价格库'} ¥${formatMoney(g.groupLowest)}/${unitLabel(g.unitCode)}`;
}
