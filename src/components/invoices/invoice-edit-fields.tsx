'use client';
import type { InvoiceDetail } from '@/lib/types';
import { Note } from '@/components/ui/states';
import { Field, Input, Textarea } from '@/components/ui/field';

/**
 * 发票的可编辑字段（明细抽屉里那一块）。
 *
 * 为什么金额不做"自动算第三项"：三项理论上 sum 相等，但 OCR 常差 1–2 分，
 * 自动补齐等于把误差藏起来。这里只校验「是不是数字、最多两位小数」，
 * 对不对由服务端按 0.01 容差判定，界面把判定结果标出来。
 */
export interface InvoiceFormState {
  invoiceNo: string;
  invoiceCode: string;
  issuedOn: string;
  /** 票面是不是红字票：决定三项金额的正负 */
  isRedLetter: boolean;
  /** 红字票冲的原票号码 */
  originalInvoiceNo: string;
  buyerName: string;
  buyerTaxNo: string;
  sellerName: string;
  sellerTaxNo: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
  remark: string;
}

export const EMPTY_INVOICE_FORM: InvoiceFormState = {
  invoiceNo: '',
  invoiceCode: '',
  issuedOn: '',
  isRedLetter: false,
  originalInvoiceNo: '',
  buyerName: '',
  buyerTaxNo: '',
  sellerName: '',
  sellerTaxNo: '',
  amount: '',
  taxAmount: '',
  totalAmount: '',
  remark: '',
};

/** 金额：允许负数，最多两位小数，不接受千分位与货币符号 */
export const INVOICE_AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;

export function invoiceFormFrom(d: InvoiceDetail): InvoiceFormState {
  return {
    invoiceNo: d.invoiceNo,
    invoiceCode: d.invoiceCode,
    issuedOn: d.issuedOn ?? '',
    isRedLetter: d.isRedLetter,
    originalInvoiceNo: d.originalInvoiceNo ?? '',
    buyerName: d.buyerName,
    buyerTaxNo: d.buyerTaxNo ?? '',
    sellerName: d.sellerName,
    sellerTaxNo: d.sellerTaxNo ?? '',
    amount: d.amount ?? '',
    taxAmount: d.taxAmount ?? '',
    totalAmount: d.totalAmount ?? '',
    remark: d.remark ?? '',
  };
}

/**
 * 本地先校验一遍再发请求。不是替代服务端校验（那才是唯一的门），
 * 而是省一个来回：必填项空的、金额填了 "1,200" 这种，本地就能说清是哪一格错。
 * 键名与表单字段同名，服务端返回的 field 走 camel() 后也能落到这里。
 */
export function validateInvoiceForm(f: InvoiceFormState): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!f.invoiceNo.trim()) issues.invoiceNo = '发票号码不能为空。';
  if (!f.buyerName.trim()) issues.buyerName = '购买方名称不能为空。';
  if (!f.sellerName.trim()) issues.sellerName = '销售方名称不能为空。';
  for (const key of ['amount', 'taxAmount', 'totalAmount'] as const) {
    const v = f[key].trim();
    if (v !== '' && !INVOICE_AMOUNT_RE.test(v)) {
      issues[key] = '只能填数字，最多两位小数。';
    }
  }
  return issues;
}

/** 提交体：空串一律转 null（清空），必填项保持字符串；不发 undefined = 不动 */
export function invoicePayload(f: InvoiceFormState): Record<string, string | boolean | null> {
  return {
    invoiceNo: f.invoiceNo.trim(),
    // 全电票没有代码：传空串，别传 null —— 唯一键靠空串兜住（NULL 不参与唯一性）
    invoiceCode: f.invoiceCode.trim(),
    issuedOn: f.issuedOn || null,
    isRedLetter: f.isRedLetter,
    originalInvoiceNo: f.originalInvoiceNo.trim() || null,
    buyerName: f.buyerName.trim(),
    sellerName: f.sellerName.trim(),
    buyerTaxNo: f.buyerTaxNo.trim() || null,
    sellerTaxNo: f.sellerTaxNo.trim() || null,
    amount: f.amount.trim() || null,
    taxAmount: f.taxAmount.trim() || null,
    totalAmount: f.totalAmount.trim() || null,
    remark: f.remark.trim() || null,
  };
}

export function InvoiceEditFields({
  form,
  errors,
  invoiceTypeLabel,
  disabled,
  autoFocusNo,
  amountCheckText,
  onChange,
}: {
  form: InvoiceFormState;
  errors: Record<string, string>;
  /** 识别出的票种（只读回显，不让手填） */
  invoiceTypeLabel: string | null;
  /** 已软删 → 整块只读：能改不能存比改不了更让人烦 */
  disabled?: boolean;
  autoFocusNo?: boolean;
  /** 三项金额不自洽时的提示（来自服务端 amount_check） */
  amountCheckText?: string;
  onChange: (patch: Partial<InvoiceFormState>) => void;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-[var(--space-4)] m-0 p-0 border-0 min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
        <Field label="发票号码" htmlFor="inv-no" required error={errors.invoiceNo} hint="全电 20 位 / 纸质 8 位">
          <Input
            id="inv-no"
            value={form.invoiceNo}
            autoFocus={autoFocusNo}
            spellCheck={false}
            placeholder="24312000000012345678"
            onChange={(e) => onChange({ invoiceNo: e.target.value })}
          />
        </Field>
        <Field label="发票代码" htmlFor="inv-code" error={errors.invoiceCode} hint="全电票没有，留空即可">
          <Input
            id="inv-code"
            value={form.invoiceCode}
            spellCheck={false}
            placeholder="044031900111"
            onChange={(e) => onChange({ invoiceCode: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
        <Field label="开票日期" htmlFor="inv-date" error={errors.issuedOn} hint="认不出来就留空，不拿上传日代替">
          <Input
            id="inv-date"
            type="date"
            value={form.issuedOn}
            onChange={(e) => onChange({ issuedOn: e.target.value })}
          />
        </Field>
        <Field label="票种" htmlFor="inv-type" hint="识别结果，不用手填">
          <Input id="inv-type" value={invoiceTypeLabel ?? ''} readOnly placeholder="识别后自动填" />
        </Field>
      </div>

      {/*
        红字票（红冲票）：勾了它，三项金额按负数入库——这是"票面性质"，不是"记账状态"。
        原发票号码只在这张是红字票时才有意义，所以跟着它一起出现；
        有了它，上传时就能提示把原票标成「已冲红」。
      */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <label className="flex items-center gap-[var(--space-2)] w-fit">
          <input
            type="checkbox"
            checked={form.isRedLetter}
            onChange={(e) => onChange({ isRedLetter: e.target.checked })}
          />
          <span className="t-sm">这是红字票（红冲票）</span>
        </label>
        <span className="t-2xs t-3">
          勾上后金额、税额、价税合计按负数记（合计算的是净额）。被它冲的那张原票再标「已冲红」——
          两步都做，一对票在合计里正好抵成 0。红字票自己就是冲减凭证，
          <strong>不能再标「已冲红」</strong>。
        </span>
        {form.isRedLetter ? (
          <Field
            label="原发票号码"
            htmlFor="inv-original-no"
            error={errors.originalInvoiceNo}
            hint="票面上「被红冲蓝字数电发票号码 / 对应正数发票号码 / 原发票号码」后面那一串"
          >
            <Input
              id="inv-original-no"
              value={form.originalInvoiceNo}
              spellCheck={false}
              placeholder="25112000000012345678"
              onChange={(e) => onChange({ originalInvoiceNo: e.target.value })}
            />
          </Field>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
        <Field label="购买方（名称）" htmlFor="inv-buyer" required error={errors.buyerName}>
          <Input
            id="inv-buyer"
            value={form.buyerName}
            placeholder="星野科技有限公司"
            onChange={(e) => onChange({ buyerName: e.target.value })}
          />
        </Field>
        <Field label="购买方税号" htmlFor="inv-buyer-tax" error={errors.buyerTaxNo}>
          <Input
            id="inv-buyer-tax"
            value={form.buyerTaxNo}
            spellCheck={false}
            placeholder="91440000MA5XXXXX0A"
            onChange={(e) => onChange({ buyerTaxNo: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
        <Field label="销售方（名称）" htmlFor="inv-seller" required error={errors.sellerName}>
          <Input
            id="inv-seller"
            value={form.sellerName}
            placeholder="云图文化传播有限公司"
            onChange={(e) => onChange({ sellerName: e.target.value })}
          />
        </Field>
        <Field label="销售方税号" htmlFor="inv-seller-tax" error={errors.sellerTaxNo}>
          <Input
            id="inv-seller-tax"
            value={form.sellerTaxNo}
            spellCheck={false}
            placeholder="91440101MA9XXXXX2B"
            onChange={(e) => onChange({ sellerTaxNo: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-[var(--space-3)]">
        <Field label="金额（不含税）" htmlFor="inv-amount" error={errors.amount} hint="填票面数字，正负由上面的红字票决定">
          <Input
            id="inv-amount"
            inputMode="decimal"
            value={form.amount}
            placeholder="未识别就留空"
            onChange={(e) => onChange({ amount: e.target.value })}
          />
        </Field>
        <Field label="税额" htmlFor="inv-tax" error={errors.taxAmount}>
          <Input
            id="inv-tax"
            inputMode="decimal"
            value={form.taxAmount}
            placeholder="未识别就留空"
            onChange={(e) => onChange({ taxAmount: e.target.value })}
          />
        </Field>
        <Field label="价税合计" htmlFor="inv-total" error={errors.totalAmount}>
          <Input
            id="inv-total"
            inputMode="decimal"
            value={form.totalAmount}
            placeholder="未识别就留空"
            onChange={(e) => onChange({ totalAmount: e.target.value })}
          />
        </Field>
      </div>

      {amountCheckText ? (
        <Note tone="warn">
          {amountCheckText}。三项金额不自动改：差几分是 OCR 的常态，硬凑等于把误差藏起来。
          以票面为准改一项，保存后服务端会重新判一次。
        </Note>
      ) : null}

      <Field label="备注" htmlFor="inv-remark" error={errors.remark}>
        <Textarea
          id="inv-remark"
          rows={2}
          value={form.remark}
          placeholder="例：红冲 24312000000012345678；或这张票对应哪个项目"
          onChange={(e) => onChange({ remark: e.target.value })}
        />
      </Field>
    </fieldset>
  );
}
