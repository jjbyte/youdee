'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, isApiError } from '@/lib/api';
import type { ItemDetail, Supplier, SupplierType, PricingNature, UnitMode } from '@/lib/types';
import { addDaysISO, formatMoney, parseLooseNumber, todayISO } from '@/lib/format';
import { PRICING_NATURE_LABELS, SUPPLIER_TYPE_LABELS, SUPPLIER_TYPE_ORDER, UNIT_LABELS, UNIT_MODE_LABELS } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Drawer, Toast } from '@/components/ui/overlay';
import { Badge } from '@/components/ui/badge';
import { Note } from '@/components/ui/states';
import { useMe } from '@/lib/use-me';
import { canCreatePrice, canManageCatalog } from '@/domain/permissions';
import { IconPlus, IconRisk } from '@/components/icons';
import { PriceTierEditor, type TierDraft } from './price-tier-editor';

const PERSONNEL_UNITS = ['day', 'session', 'person_day', 'hour', 'half_day'] as const;

/** unit_code → unit_mode（单条价自己的计价方式，只读派生；见 §C.4 三字段分工） */
const UNIT_CODE_TO_MODE: Record<string, UnitMode> = {
  day: 'per_day',
  session: 'per_event',
  person_day: 'per_person_day',
  hour: 'per_hour',
  half_day: 'per_half_day',
};

/**
 * 录一条价（§C.4B）：默认只露 4 个必填（供应商 / 单价 / 单位 / 生效日），其余全部折叠。
 * 录价路径每多一个必填，录价意愿就掉一截。
 */
export function PriceEntryDrawer({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: Pick<ItemDetail, 'id' | 'name' | 'itemType' | 'baseUnitCode' | 'baseUnitName' | 'compareUnitCode'> & {
    effectivePricingNature?: PricingNature | null;
  };
  onSaved?: () => void;
}) {
  const { user } = useMe();
  const role = user?.role ?? 'member';
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [showSupplierList, setShowSupplierList] = useState(false);
  const [newSupplier, setNewSupplier] = useState<{ name: string; type: SupplierType } | null>(null);

  const [unitPrice, setUnitPrice] = useState('');
  const [unitPriceNote, setUnitPriceNote] = useState('');
  const [unitPriceError, setUnitPriceError] = useState('');
  const [unitCode, setUnitCode] = useState(item.baseUnitCode);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [pricingNature, setPricingNature] = useState<PricingNature>(
    item.itemType === 'personnel' ? 'service' : (item.effectivePricingNature ?? 'purchase'),
  );

  const [expanded, setExpanded] = useState(false);
  // 默认含税：供应商报过来的价基本都是含税的，报价单与客户版也一律按含税算，
  // 所以"录进来就是含税"才是常态，"先按不含税记、用的时候再换算"没有这条路——
  // 取价按口径严格匹配、不回落，记错口径的价在含税单子里直接取不到。
  // 服务端 price-write 的默认值也是 true，这两处必须一致（前端显式传 false 会顶掉服务端默认）。
  const [taxIncluded, setTaxIncluded] = useState(true);
  const [moq, setMoq] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [baseUnitQty, setBaseUnitQty] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [tiers, setTiers] = useState<TierDraft[]>([]);

  const [busy, setBusy] = useState(false);
  const [overlap, setOverlap] = useState<{ message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    api
      .suppliers({ limit: 100 })
      .then((p) => setSuppliers(p.items ?? []))
      .catch(() => setSuppliers([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSavedCount(0);
      setOverlap(null);
      setError(null);
      setSupplierQuery('');
      setSupplierId('');
      setSupplierQuery('');
      // 关掉抽屉等于这次录入结束：下次打开回到默认含税。
      // 否则给某一家关过含税之后，后面每一家都会静默按不含税记。
      setTaxIncluded(true);
    }
  }, [open]);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const unitOptions = item.itemType === 'personnel' ? [...PERSONNEL_UNITS] : Object.keys(UNIT_LABELS);
  const needsConversion = unitCode !== (item.compareUnitCode ?? item.baseUnitCode);

  const filtered = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    const list = q ? suppliers.filter((s) => s.name.toLowerCase().includes(q)) : suppliers;
    return list.slice(0, 8);
  }, [suppliers, supplierQuery]);

  function resetForNext() {
    setSupplierId('');
    setSupplierQuery('');
    // 单位必须清空：不同供应商的报价单位经常不一样，带错单位比多点一次鼠标危险一百倍
    setUnitCode('');
    setUnitPrice('');
    setUnitPriceNote('');
    setUnitPriceError('');
    setMoq('');
    setLeadTime('');
    setBaseUnitQty('');
    setSourceNote('');
    setTiers([]);
    // 下一条价也回到含税，否则「保存并再录一家」从第二条起会静默变回不含税
    setTaxIncluded(true);
    setOverlap(null);
    setSavedCount((n) => n + 1);
  }

  async function createSupplier() {
    if (!newSupplier) return;
    try {
      const s = await api.createSupplier({ name: newSupplier.name, type: newSupplier.type });
      setSuppliers((prev) => [s, ...prev]);
      setSupplierId(s.id);
      setSupplierQuery(s.name);
      setNewSupplier(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function save(closePrevious = false, thenAnother = false) {
    setError(null);
    setOverlap(null);
    if (!supplierId) {
      setError('先选供应商。');
      return;
    }
    if (!unitCode) {
      setError('单位没填。不同供应商的单位经常不一样，这里必须自己选一次。');
      return;
    }
    const parsed = parseLooseNumber(unitPrice);
    if (parsed.error || !parsed.value) {
      setUnitPriceError(parsed.error ?? '填个单价。');
      return;
    }
    if (needsConversion && baseUnitQty) {
      const q = Number(baseUnitQty);
      if (q === 1) {
        setError(`1 ${UNIT_LABELS[unitCode] ?? unitCode} = 1 ${item.baseUnitName} 的话，直接把上面的单位改成「${item.baseUnitName}」就行，不用填折算。`);
        return;
      }
      if (q < 1) {
        setError('小于 1 的换算是说反了吧？建议把比价单位改成更小的那个单位。');
        return;
      }
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        itemId: item.id,
        supplierId,
        unitCode,
        pricingNature: item.itemType === 'personnel' ? 'service' : pricingNature,
        unitPrice: parsed.value,
        effectiveFrom,
        taxIncluded,
        closePrevious,
      };
      if (moq) body.moq = moq;
      if (leadTime) body.defaultLeadTimeDays = Number(leadTime);
      if (needsConversion && baseUnitQty) body.baseUnitQty = baseUnitQty;
      if (sourceNote) body.sourceNote = sourceNote;
      const cleanTiers = tiers
        .filter((t) => t.min && t.price)
        .map((t) => ({ minQty: t.min, unitPrice: t.price }));
      if (cleanTiers.length > 0) body.tiers = cleanTiers;

      await api.createPrice(body);
      const supplierName = selectedSupplier?.name ?? '这家';
      setToast(
        `录好了。${supplierName} ${formatMoney(parsed.value, { symbol: true })} 元/${UNIT_LABELS[unitCode] ?? unitCode}，旧价已结束。`,
      );
      onSaved?.();
      if (thenAnother) resetForNext();
      else onClose();
    } catch (e) {
      if (isApiError(e) && e.code === 40902) {
        setOverlap({ message: e.message });
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="录一条价"
        subtitle={item.name}
        closeOnScrim={false}
        footer={
          <>
            {savedCount > 0 ? (
              <span className="t-xs t-3">已录 {savedCount} 家 · 还能接着录</span>
            ) : null}
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void save(false, true)}>
              保存并再录一家
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save(false, false)}>
              保存
            </Button>
          </>
        }
      >
        {!canCreatePrice(role) ? (
          <Note tone="warn">当前账号不能录入价格。</Note>
        ) : null}

        <Field label="供应商" htmlFor="pe-supplier" required hint="可以搜联系人 / 别名，没有就新建一个。">
          <div style={{ position: 'relative' }}>
            <Input
              id="pe-supplier"
              autoFocus
              value={supplierQuery}
              placeholder="金桥桁架厂"
              autoComplete="off"
              onFocus={() => setShowSupplierList(true)}
              onChange={(e) => {
                setSupplierQuery(e.target.value);
                setSupplierId('');
                setShowSupplierList(true);
              }}
            />
            {showSupplierList && !supplierId ? (
              <div
                className="panel"
                style={{
                  position: 'absolute',
                  zIndex: 30,
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 4px)',
                  padding: 'var(--space-2)',
                  boxShadow: 'var(--shadow-2)',
                }}
              >
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="nav-item"
                    style={{ color: 'var(--fg)', width: '100%' }}
                    onClick={() => {
                      setSupplierId(s.id);
                      setSupplierQuery(s.name);
                      setShowSupplierList(false);
                    }}
                  >
                    <span className="truncate">{s.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="t-2xs t-3">{SUPPLIER_TYPE_LABELS[s.type]}</span>
                  </button>
                ))}
                {filtered.length === 0 ? <div className="t-sm t-3 p-[var(--space-2)]">没找到这家。</div> : null}
                {canManageCatalog(role) ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm w-full !justify-start"
                    onClick={() => setNewSupplier({ name: supplierQuery.trim(), type: 'factory' })}
                  >
                    <IconPlus size={16} />
                    新建「{supplierQuery.trim() || '这家'}」
                  </button>
                ) : (
                  <div className="t-2xs t-3 p-[var(--space-2)]">没有这家？让管理员先建一下供应商。</div>
                )}
              </div>
            ) : null}
          </div>
        </Field>

        {newSupplier ? (
          <div className="panel flex flex-col gap-[var(--space-3)]">
            <div className="t-sm fw-med">新建供应商</div>
            <Input
              value={newSupplier.name}
              onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
              placeholder="供应商名称"
              aria-label="供应商名称"
            />
            <Select
              value={newSupplier.type}
              onChange={(e) => setNewSupplier({ ...newSupplier, type: e.target.value as SupplierType })}
              aria-label="供应商类型"
            >
              {SUPPLIER_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {SUPPLIER_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <div className="flex gap-[var(--space-2)]">
              <Button variant="primary" size="sm" onClick={() => void createSupplier()}>
                建这家
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNewSupplier(null)}>
                算了
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-[1fr_auto] gap-[var(--space-4)]">
          <Field label="单价" htmlFor="pe-price" required error={unitPriceError || undefined}>
            <div className="flex items-center gap-[var(--space-2)]">
              <Input
                id="pe-price"
                inputMode="decimal"
                className="num"
                style={{ textAlign: 'right' }}
                value={unitPrice}
                onChange={(e) => {
                  setUnitPrice(e.target.value);
                  const r = parseLooseNumber(e.target.value);
                  setUnitPriceError(r.error ?? '');
                  setUnitPriceNote(r.note ?? '');
                }}
                placeholder="28.00"
              />
              <span className="t-sm t-3">元</span>
            </div>
          </Field>
          <Field label="单位" htmlFor="pe-unit" required>
            <Select id="pe-unit" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} style={{ width: '120px' }}>
              <option value="">请选择…</option>
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u] ?? u}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {unitPriceNote ? <div className="hint">{unitPriceNote}</div> : null}
        {selectedSupplier?.type === 'internal' ? (
          <div className="hint">这是内部成本折算，不是对外支付。</div>
        ) : null}

        <Field label="生效日" htmlFor="pe-from" required hint="失效日留空 = 长期有效。">
          <Input
            id="pe-from"
            type="date"
            value={effectiveFrom}
            max={addDaysISO(todayISO(), 3650)}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            style={{ width: '180px' }}
          />
        </Field>

        {item.itemType === 'material' ? (
          <Field label="交易性质" htmlFor="pe-nature" hint="影响比价分组：租价和买断价不能互相比较。">
            <Select
              id="pe-nature"
              value={pricingNature}
              onChange={(e) => setPricingNature(e.target.value as PricingNature)}
            >
              {(['purchase', 'rental_per_day', 'custom_made'] as PricingNature[]).map((n) => (
                <option key={n} value={n}>
                  {PRICING_NATURE_LABELS[n]}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="hint">
            计价方式由「单位」决定：
            {unitCode
              ? UNIT_MODE_LABELS[UNIT_CODE_TO_MODE[unitCode] ?? 'per_day']
              : '还没选单位'}
            。按人天 = 人数 × 天数，MVP 不自动换算，请直接填结果（3 人 2 天填 6）。
          </div>
        )}

        <div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {/* 口径藏在折叠区里，用户就不知道这条价是按什么记的——所以把它写进触发文字里 */}
            {expanded
              ? '收起更多'
              : `展开更多（${taxIncluded ? '含税价' : '不含税价'} · 起订量 / 阶梯价 / 交期）`}
          </Button>
        </div>

        {expanded ? (
          <div className="flex flex-col gap-[var(--space-4)]">
            <div className="flex flex-col gap-[var(--space-1)]">
              <label className="switch">
                <input type="checkbox" checked={taxIncluded} onChange={(e) => setTaxIncluded(e.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
                含税价
              </label>
              <span className="hint">
                {taxIncluded
                  ? '默认含税。供应商报的价基本都是含税的，客户版报价单也按含税算。'
                  : '这条按不含税记。它只能在「不含税」口径的单子里取到价，含税单子会报「没有有效价格」。'}
              </span>
            </div>

            {needsConversion ? (
              <Field
                label={`1 ${item.baseUnitName} = 多少${UNIT_LABELS[unitCode] ?? '单位'}？`}
                htmlFor="pe-conv"
                hint="填了才能和别的单位一起比。填 1 等于谎称单位一致，会被拒。"
              >
                <Input
                  id="pe-conv"
                  inputMode="decimal"
                  className="num"
                  value={baseUnitQty}
                  onChange={(e) => setBaseUnitQty(e.target.value)}
                  placeholder="12"
                  style={{ width: '120px' }}
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-[var(--space-4)]">
              <Field label={`最小起订量${unitCode ? `（${UNIT_LABELS[unitCode] ?? ''}）` : ''}`} htmlFor="pe-moq">
                <Input id="pe-moq" inputMode="decimal" className="num" value={moq} onChange={(e) => setMoq(e.target.value)} />
              </Field>
              <Field label="交期（天）" htmlFor="pe-lead">
                <Input id="pe-lead" inputMode="numeric" className="num" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
              </Field>
            </div>

            <PriceTierEditor
              tiers={tiers}
              onChange={setTiers}
              hint={pricingNature === 'rental_per_day' ? '如：租 3 天以上通常有折' : '如：100 – 499 ㎡ 一个价'}
            />

            <Field label="来源备注" htmlFor="pe-note" hint="例：2026-10 老王微信问价">
              <Input id="pe-note" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {overlap ? (
          <Note tone="warn">
            <div className="flex flex-col gap-[var(--space-2)]">
              <span>
                <IconRisk size={16} className="inline" /> {overlap.message}
              </span>
              <span className="flex gap-[var(--space-2)]">
                <Button variant="primary" size="sm" loading={busy} onClick={() => void save(true, false)}>
                  确认，结束旧价
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOverlap(null)}>
                  改生效日
                </Button>
              </span>
            </div>
          </Note>
        ) : null}

        {error ? (
          <Note tone="danger">
            {error}
          </Note>
        ) : null}

        <div className="t-2xs t-3 flex items-center gap-[var(--space-2)]">
          <Badge tone="neutral">只影响这一条价</Badge>
          {item.baseUnitName ? `比价基准单位：${item.baseUnitName}` : null}
        </div>
      </Drawer>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
