'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { SUPPLIER_TYPE_LABELS, SUPPLIER_TYPE_ORDER } from '@/lib/labels';
import type { Supplier, SupplierType } from '@/lib/types';
import {
  INVOICE_KEYS,
  INVOICE_LABELS,
  INVOICE_MAX,
  invoiceFilledCount,
  normalizeInvoiceField,
  type InvoiceKey,
} from '@/domain/invoice-info';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Drawer } from '@/components/ui/overlay';
import { Note } from '@/components/ui/states';

/** 五个输入框的取值，字符串态（空串 = 没填，提交时换成 null） */
type InvoiceDraft = Record<InvoiceKey, string>;

const EMPTY_INVOICE: InvoiceDraft = {
  tax_no: '',
  company_address: '',
  company_phone: '',
  bank_name: '',
  bank_account: '',
};

const INVOICE_PLACEHOLDER: Record<InvoiceKey, string> = {
  tax_no: '91330100MA2XXXXXX7',
  company_address: '杭州市余杭区文一西路 969 号 3 幢',
  company_phone: '0571-8888 6666',
  bank_name: '中国工商银行杭州文新路支行',
  bank_account: '1202 0245 0990 0123 456',
};

const INVOICE_HINT: Partial<Record<InvoiceKey, string>> = {
  company_phone: '发票上印的那个号，通常不是上面「电话」那个联系人手机。',
  bank_account: '空格和「-」存的时候会自动去掉，抄的时候不用管格式。',
};

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
 *
 * 开票信息（v1.13 新增）：纳税人识别号 / 公司地址 / 联系电话 / 开户银行 / 银行账号，
 * 客户要求是**可选字段**——所以这一块没有红星、空着也能保存，
 * 填了以后财务开票不用再挨个问。校验逐格进行，错了当场说，不等保存后弹一句总错。
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
  const [invoice, setInvoice] = useState<InvoiceDraft>(EMPTY_INVOICE);
  const [invoiceErr, setInvoiceErr] = useState<Partial<Record<InvoiceKey, string>>>({});
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
    setInvoice({
      tax_no: s.taxNo ?? '',
      company_address: s.companyAddress ?? '',
      company_phone: s.companyPhone ?? '',
      bank_name: s.bankName ?? '',
      bank_account: s.bankAccount ?? '',
    });
    setInvoiceErr({});
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

  /** 单格校验：离开输入框时才说，边打字边报红会让人以为自己一直被骂 */
  const checkInvoice = useCallback((key: InvoiceKey, value: string) => {
    const res = normalizeInvoiceField(key, value);
    setInvoiceErr((prev) => ({ ...prev, [key]: res.error }));
    return res;
  }, []);

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
    // 五格一次校验，有错就停下并把错误落在各自格子上（不把用户滚回顶部找一句话）
    const nextErr: Partial<Record<InvoiceKey, string>> = {};
    const payloadInvoice: Record<string, string | null> = {};
    for (const key of INVOICE_KEYS) {
      const res = normalizeInvoiceField(key, invoice[key]);
      if (res.error) nextErr[key] = res.error;
      payloadInvoice[key] = res.value;
    }
    setInvoiceErr(nextErr);
    const badCount = Object.keys(nextErr).length;
    if (badCount > 0) {
      setError(`开票信息有 ${badCount} 处要改一下，已在对应格子上标出来了。`);
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
        ...payloadInvoice,
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
  const filled = invoiceFilledCount({
    tax_no: invoice.tax_no,
    company_address: invoice.company_address,
    company_phone: invoice.company_phone,
    bank_name: invoice.bank_name,
    bank_account: invoice.bank_account,
  });

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

          {/*
            开票信息：客户要求「可选字段」，所以这一块没有必填标记、空着能保存。
            但它不是装饰——填了以后财务开票不用再挨个打电话问税号。
          */}
          <div className="flex flex-col gap-[var(--space-4)] pt-[var(--space-5)] border-t border-[var(--border)]">
            <div>
              <div className="fw-semi t-sm">
                开票信息 <span className="t-3 fw-normal">（可选）</span>
                <span className="t-3 fw-normal num ml-[var(--space-2)]">已填 {filled}/5</span>
              </div>
              <p className="t-xs t-3 mt-[var(--space-1)]">
                开发票要用的五项。不填不影响录价、比价、出单；填了以后财务不用再问你一遍。
              </p>
            </div>

            <Field
              label="纳税人识别号"
              htmlFor="ve-tax-no"
              // 报错时把提示语收起来：两行灰字加一行红字，人只会挑最短的那行读，
              // 而「15–20 位字母或数字」正是他现在需要看的那行
              hint={invoiceErr.tax_no ? undefined : '统一社会信用代码就是它，18 位。从营业执照或开票资料里粘，别手抄。'}
              error={invoiceErr.tax_no}
            >
              <Input
                id="ve-tax-no"
                className="num-code"
                aria-invalid={invoiceErr.tax_no ? true : undefined}
                maxLength={INVOICE_MAX.tax_no}
                value={invoice.tax_no}
                placeholder={INVOICE_PLACEHOLDER.tax_no}
                // 税号里没有小写，边打边转大写：粘进来的小写字母不必等保存才发现不对
                onChange={(e) => setInvoice((v) => ({ ...v, tax_no: e.target.value.toUpperCase() }))}
                onBlur={() => checkInvoice('tax_no', invoice.tax_no)}
              />
            </Field>

            <Field label="公司地址" htmlFor="ve-address" error={invoiceErr.company_address}>
              <Input
                id="ve-address"
                aria-invalid={invoiceErr.company_address ? true : undefined}
                maxLength={INVOICE_MAX.company_address}
                value={invoice.company_address}
                placeholder={INVOICE_PLACEHOLDER.company_address}
                onChange={(e) => setInvoice((v) => ({ ...v, company_address: e.target.value }))}
                onBlur={() => checkInvoice('company_address', invoice.company_address)}
              />
            </Field>

            <Field
              label="联系电话"
              htmlFor="ve-invoice-phone"
              hint={invoiceErr.company_phone ? undefined : INVOICE_HINT.company_phone}
              error={invoiceErr.company_phone}
            >
              <Input
                id="ve-invoice-phone"
                className="num-code"
                aria-invalid={invoiceErr.company_phone ? true : undefined}
                maxLength={INVOICE_MAX.company_phone}
                value={invoice.company_phone}
                placeholder={INVOICE_PLACEHOLDER.company_phone}
                onChange={(e) => setInvoice((v) => ({ ...v, company_phone: e.target.value }))}
                onBlur={() => checkInvoice('company_phone', invoice.company_phone)}
              />
            </Field>

            <Field label="开户银行" htmlFor="ve-bank-name" error={invoiceErr.bank_name}>
              <Input
                id="ve-bank-name"
                aria-invalid={invoiceErr.bank_name ? true : undefined}
                maxLength={INVOICE_MAX.bank_name}
                value={invoice.bank_name}
                placeholder={INVOICE_PLACEHOLDER.bank_name}
                onChange={(e) => setInvoice((v) => ({ ...v, bank_name: e.target.value }))}
                onBlur={() => checkInvoice('bank_name', invoice.bank_name)}
              />
            </Field>

            <Field
              label="银行账号"
              htmlFor="ve-bank-account"
              hint={invoiceErr.bank_account ? undefined : INVOICE_HINT.bank_account}
              error={invoiceErr.bank_account}
            >
              <Input
                id="ve-bank-account"
                className="num-code"
                aria-invalid={invoiceErr.bank_account ? true : undefined}
                inputMode="numeric"
                maxLength={INVOICE_MAX.bank_account}
                value={invoice.bank_account}
                placeholder={INVOICE_PLACEHOLDER.bank_account}
                onChange={(e) => setInvoice((v) => ({ ...v, bank_account: e.target.value }))}
                onBlur={() => checkInvoice('bank_account', invoice.bank_account)}
              />
            </Field>
          </div>

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
