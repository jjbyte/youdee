'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { SUPPLIER_TYPE_LABELS, SUPPLIER_TYPE_ORDER } from '@/lib/labels';
import type { Supplier, SupplierType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/**
 * 编辑供应商档案（§C.6）。
 *
 * 存在的理由和物料/人员档案编辑器一模一样：`PATCH /suppliers/:id` 早就写好了，
 * 但界面上没有任何入口——详情抽屉只给了一个「删除供应商」，列表操作列只有「看报价」。
 * 所以管理员登进来看到的供应商页是**纯只读的**，会以为权限没开。
 *
 * 两条在界面上提前说清的规则：
 *   · 有价格记录时不能删，只能停用（40904）——这里给停用开关，删除仍在详情抽屉里。
 *   · 改名/改联系人只影响之后的单子：报价单行里存的是当时的名字快照，
 *     所以不用担心「改了名历史单子跟着变」。这一点写在备注旁边的说明里。
 */
export function VendorEditDrawer({
  supplierId,
  seed,
  open,
  onClose,
  onSaved,
}: {
  supplierId: string | null;
  /** 列表里已有的那条，用来在接口回来之前先把名字显示出来（避免抽屉标题闪一下空白） */
  seed?: Supplier | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (s: Supplier) => void;
}) {
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<SupplierType>('factory');
  const [region, setRegion] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [shopUrl, setShopUrl] = useState('');
  const [note, setNote] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback((s: Supplier) => {
    setDetail(s);
    setName(s.name ?? '');
    setType(s.type ?? 'factory');
    setRegion(s.region ?? '');
    setContactName(s.contactName ?? '');
    setContactPhone(s.contactPhone ?? '');
    setLeadTime(s.defaultLeadTimeDays == null ? '' : String(s.defaultLeadTimeDays));
    setShopUrl(s.shopUrl ?? '');
    setNote(s.note ?? '');
    setIsActive(Boolean(s.isActive));
    setError(null);
  }, []);

  useEffect(() => {
    if (!open || !supplierId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    api
      .supplier(supplierId)
      .then((s) => alive && reset(s))
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, supplierId, reset]);

  async function submit() {
    if (!supplierId) return;
    if (!name.trim()) {
      setError('供应商名不能空着。');
      return;
    }
    const days = leadTime.trim();
    if (days && (!/^\d+$/.test(days) || Number(days) > 365)) {
      setError('默认交期填 0–365 的整数天，不填就是没有默认值。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSupplier(supplierId, {
        name: name.trim(),
        type,
        region: region.trim() || null,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        defaultLeadTimeDays: days ? Number(days) : null,
        shopUrl: shopUrl.trim() || null,
        note: note.trim() || null,
        isActive,
      });
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const title = detail?.name ?? seed?.name ?? '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="编辑供应商"
      subtitle={title}
      closeOnScrim={false}
      footer={
        <>
          {detail && detail.isActive === false ? (
            <span className="t-xs t-3">已停用：不出现在列表，历史报价单照常显示。</span>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={loading || !detail} onClick={() => void submit()}>
            保存
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="t-sm t-3">正在读…</div>
      ) : !detail ? (
        <Note tone="danger">{error || '没读到这家供应商。'}</Note>
      ) : (
        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="供应商名" htmlFor="ve-name" required hint="改名只影响之后的单子；已发出的报价单里存的是当时的名字快照。">
            <Input id="ve-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：杭州华艺会展制作" />
          </Field>

          <Field label="类型" htmlFor="ve-type" hint="只影响筛选和比价时的标签，不改任何历史价。">
            <Select id="ve-type" value={type} onChange={(e) => setType(e.target.value as SupplierType)}>
              {SUPPLIER_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {SUPPLIER_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="地区" htmlFor="ve-region" hint="写城市就够了：同一个物料本地和外地的差旅差很多。">
            <Input id="ve-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="例：杭州" />
          </Field>

          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <Field label="联系人" htmlFor="ve-contact">
              <Input id="ve-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label="电话" htmlFor="ve-phone">
              <Input id="ve-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Field>
          </div>

          <Field
            label="默认交期（天）"
            htmlFor="ve-lead"
            hint="录价时作为默认值带出；留空表示这家没有固定交期。"
          >
            <Input
              id="ve-lead"
              inputMode="numeric"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              placeholder="例：7"
            />
          </Field>

          <Field label="店铺 / 报价链接" htmlFor="ve-shop" hint="淘宝店、1688、微信报价文档都行。">
            <Input id="ve-shop" value={shopUrl} onChange={(e) => setShopUrl(e.target.value)} placeholder="https://" />
          </Field>

          <Field label="备注" htmlFor="ve-note" hint="写能影响报价的事：起订量、加急费、要不要押金。">
            <Textarea id="ve-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <label className="switch">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            启用（停用后不出现在列表和录价下拉里）
          </label>

          <Note tone="neutral">
            有价格记录的供应商不能删除，只能停用——历史报价单要能把这家名字解析出来。
            真要删，先去它报过的价里把价停掉。
          </Note>

          {error ? <div className="field-error">{error}</div> : null}
        </div>
      )}
    </Drawer>
  );
}
