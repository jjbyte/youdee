import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_INVOICE_TYPES,
  VAT_ELECTRONIC_INFO_SUBTYPES,
  VAT_INVOICE_INFO_SUBTYPES,
  isVatElectronicInfoGroup,
  isVatInvoiceInfoGroup,
  mapInvoiceItem,
  mapRecognizeResult,
} from '@/domain/invoice-ocr';

/**
 * 两份真实形状的响应 fixture（按腾讯云《通用票据识别（高级版）》返回结构手抄）。
 *
 * 这两份 fixture 故意埋了**诱饵字段**，用来证明"取错字段就红"：
 *   - 纸质专票里 `ElectronicFullNumber` 有一个和 `Number` 不同的值
 *     → 若代码优先取 ElectronicFullNumber，断言全红；
 *   - 全电普票里塞了 `Code` 与 `ElectronicFullNumber`（`VatElectronicInfo` 里
 *     真实不存在这两个字段）→ 若代码不分结构体一把梭取 `.Code`，全电票会变成
 *     "有发票代码"，而全电票的唯一键是 (空代码, 20 位号码)，多一个假代码等于
 *     同一张票能在库里存两遍。
 */
const PAPER_SPECIAL = {
  Code: 'OK',
  Type: 3,
  Page: 1,
  SubType: 'VatSpecialInvoice',
  SubTypeDescription: '增值税专用发票',
  SingleInvoiceInfos: {
    VatSpecialInvoice: {
      Title: '上海增值税专用发票',
      Code: '044001900111',
      Number: '12345678',
      // 诱饵：纸质全电票才单独有这个字段
      ElectronicFullNumber: '99999999',
      Date: '2026年04月11日',
      Buyer: '有底文化传播（上海）有限公司',
      BuyerTaxID: '91310115MA1K38XQ2F',
      Seller: '上海某某展览服务有限公司',
      SellerTaxID: '91310104MA1FL2YB7X',
      PretaxAmount: '1000.00',
      // 诱饵：SubTotal 是小计，与不含税金额（PretaxAmount）不同
      SubTotal: '999.99',
      Tax: '130.00',
      Total: '1130.00',
      TotalCn: '壹仟壹佰叁拾圆整',
      // 陷阱：文档里是 BuyerTaxID / SellerTaxID（大写 ID），不是 BuyerName / SellerTaxNo
      BuyerName: '不该被取到的名字',
      SellerTaxNo: '不该被取到的税号',
    },
  },
};

const ELECTRONIC_NORMAL = {
  Code: 'OK',
  Type: 16,
  Page: 2,
  SubType: 'VatElectronicInvoiceFull',
  SubTypeDescription: '电子发票（普通发票）',
  SingleInvoiceInfos: {
    VatElectronicInvoiceFull: {
      Title: '电子发票（普通发票）',
      Number: '26312000000098765432',
      // 诱饵：VatElectronicInfo 结构体里没有 Code
      Code: 'DECOYCODE000',
      // 诱饵：VatElectronicInfo 结构体里没有 ElectronicFullNumber
      ElectronicFullNumber: '0000000000',
      Date: '2026-03-01',
      Buyer: '有底文化传播（上海）有限公司',
      BuyerTaxID: '91310115MA1K38XQ2F',
      Seller: '北京某某科技有限公司',
      SellerTaxID: '91110108MA01ABCD2X',
      PretaxAmount: '500.00',
      Tax: '30.00',
      Total: '530.00',
    },
  },
};

describe('结构体分组表', () => {
  it('VatInvoiceInfo 组有 6 个 SubType，且都不在 VatElectronicInfo 组里', () => {
    expect(VAT_INVOICE_INFO_SUBTYPES).toHaveLength(6);
    for (const s of VAT_INVOICE_INFO_SUBTYPES) {
      expect(isVatElectronicInfoGroup(s)).toBe(false);
    }
  });

  it('全电两组只认 VatElectronicInvoiceFull / VatElectronicSpecialInvoiceFull', () => {
    expect(VAT_ELECTRONIC_INFO_SUBTYPES).toEqual([
      'VatElectronicInvoiceFull',
      'VatElectronicSpecialInvoiceFull',
    ]);
  });

  it('收单范围只有 Type 3（增值税发票）与 16（全电发票）', () => {
    expect(ACCEPTED_INVOICE_TYPES).toEqual([3, 16]);
  });
});

describe('纸质专票（VatInvoiceInfo 组）', () => {
  const r = mapInvoiceItem(PAPER_SPECIAL);

  it('能映射成功', () => {
    expect(r.ok).toBe(true);
  });

  it('号码取 Number，不是 ElectronicFullNumber', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceNo).toBe('12345678');
    expect(r.invoice.invoiceNo).not.toBe('99999999');
  });

  it('发票代码取 Code', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceCode).toBe('044001900111');
  });

  it('开票日期是中文格式也能解析', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.issuedOn).toBe('2026-04-11');
  });

  it('购买方 / 销售方取 Buyer / Seller（不是 BuyerName）', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.buyerName).toBe('有底文化传播（上海）有限公司');
    expect(r.invoice.sellerName).toBe('上海某某展览服务有限公司');
    expect(r.invoice.buyerName).not.toBe('不该被取到的名字');
  });

  it('税号取 SellerTaxID（大写 ID），不是 SellerTaxNo', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.sellerTaxNo).toBe('91310104MA1FL2YB7X');
    expect(r.invoice.buyerTaxNo).toBe('91310115MA1K38XQ2F');
  });

  it('金额取 PretaxAmount（不是 SubTotal）、Tax、Total，且三项自洽', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.amount).toBe('1000.00');
    expect(r.invoice.taxAmount).toBe('130.00');
    expect(r.invoice.totalAmount).toBe('1130.00');
    expect(r.invoice.amountCheck).toBe('ok');
  });

  it('票种落 SubType 原值 + 中文描述，状态启发式为 normal', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceType).toBe('VatSpecialInvoice');
    expect(r.invoice.invoiceTypeLabel).toBe('增值税专用发票');
    expect(r.invoice.status).toBe('normal');
    expect(r.invoice.page).toBe(1);
  });

  it('ocr_raw 保留本票那一段原文（口径变了能回溯，不必再花钱重识别）', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.raw).toMatchObject({ subType: 'VatSpecialInvoice', Number: '12345678' });
  });
});

describe('全电普票（VatElectronicInfo 组）', () => {
  const r = mapInvoiceItem(ELECTRONIC_NORMAL);

  it('能映射成功', () => {
    expect(r.ok).toBe(true);
  });

  it('20 位号码取 Number（不是 ElectronicFullNumber）', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceNo).toBe('26312000000098765432');
    expect(r.invoice.invoiceNo).not.toBe('0000000000');
  });

  it('全电票没有发票代码 → 空串，即使响应里带了 Code 也不取', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceCode).toBe('');
    expect(r.invoice.invoiceCode).not.toBe('DECOYCODE000');
  });

  it('日期是 yyyy-mm-dd 时也走同一个解析器', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.issuedOn).toBe('2026-03-01');
  });

  it('金额与税额照字段映射', () => {
    if (!r.ok) throw new Error('should map');
    expect([r.invoice.amount, r.invoice.taxAmount, r.invoice.totalAmount]).toEqual(['500.00', '30.00', '530.00']);
    expect(r.invoice.amountCheck).toBe('ok');
  });
});

describe('红票与异常输入', () => {
  it('三项为负 → 判 red 并归一成负数', () => {
    const red = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatCommonInvoice',
      SubTypeDescription: '增值税普通发票',
      SingleInvoiceInfos: {
        VatCommonInvoice: {
          Code: '044001900112',
          Number: '87654321',
          Date: '2026-03-02',
          Buyer: '有底文化',
          Seller: '某某展览',
          PretaxAmount: '-1000.00',
          Tax: '-130.00',
          Total: '-1130.00',
        },
      },
    };
    const r = mapInvoiceItem(red);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.status).toBe('red');
    expect(r.invoice.statusReason).toBe('amount_negative');
    expect(r.invoice.totalAmount).toBe('-1130.00');
    // 三项自洽（绝对值口径比较）
    expect(r.invoice.amountCheck).toBe('ok');
  });

  it('票面含「红字」但没有负号 → 仍判 red（OCR 不保证给负号）', () => {
    const redTitle = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatCommonInvoice',
      SingleInvoiceInfos: {
        VatCommonInvoice: {
          Title: '增值税普通发票（红字）',
          Code: '044001900113',
          Number: '11223344',
          Date: '2026-03-03',
          Buyer: '有底文化',
          Seller: '某某展览',
          Total: '1130.00',
        },
      },
    };
    const r = mapInvoiceItem(redTitle);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.status).toBe('red');
    expect(r.invoice.statusReason).toBe('title_red');
    // 只有 total 时也归一成负数
    expect(r.invoice.totalAmount).toBe('-1130.00');
  });

  it('Type 不在 {3,16} → 42208 not_vat_invoice（火车票混不进来）', () => {
    const train = {
      Code: 'OK',
      Type: 2,
      Page: 1,
      SubType: 'TrainTicket',
      SingleInvoiceInfos: {},
    };
    const r = mapInvoiceItem(train);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should reject');
    expect(r.skip.code).toBe(42208);
    expect(r.skip.reason).toBe('not_vat_invoice');
  });

  it('增值税卷票（Type 3 但 SubType 不在分组表）→ 41501 unsupported_sub_type', () => {
    const roll = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatInvoiceRoll',
      SingleInvoiceInfos: { VatInvoiceRoll: { Code: '044001900114', Number: '55667788' } },
    };
    const r = mapInvoiceItem(roll);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should reject');
    expect(r.skip.code).toBe(41501);
    expect(r.skip.reason).toBe('unsupported_sub_type');
  });

  it('号码认不出 → 42208（入库后永远搜不到的票等于占位）', () => {
    const bad = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatSpecialInvoice',
      SingleInvoiceInfos: { VatSpecialInvoice: { Code: '044001900115', Number: '12' } },
    };
    const r = mapInvoiceItem(bad);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should reject');
    expect(r.skip.code).toBe(42208);
    expect(r.skip.reason).toBe('invoice_no_unreadable');
  });

  it('识别项自带错误码（Code !== OK）→ 42208', () => {
    const r = mapInvoiceItem({ Code: 'FailedOperation.ImageBlur', Type: 3, Page: 1, SingleInvoiceInfos: {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should reject');
    expect(r.skip.code).toBe(42208);
  });

  it('SmallInvoiceInfos 是数组形态时也吃得下（线上见过）', () => {
    const arrayShape = {
      Code: 'OK',
      Type: 3,
      Page: 3,
      SubType: 'VatSpecialInvoice',
      SingleInvoiceInfos: [{ VatSpecialInvoice: { Code: '044001900116', Number: '99887766', Total: '113.00' } }],
    };
    const r = mapInvoiceItem(arrayShape);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceNo).toBe('99887766');
    expect(r.invoice.totalAmount).toBe('113.00');
  });
});

describe('整份响应（多页 PDF / 混贴）', () => {
  it('一次返回多张票：items 与 skipped 分开报，requestId 一起带出', () => {
    const res = {
      RequestId: 'a1b2c3d4-0000-1111-2222-333344445555',
      TotalPDFCount: 3,
      MixedInvoiceItems: [PAPER_SPECIAL, ELECTRONIC_NORMAL, { Code: 'OK', Type: 2, Page: 3, SubType: 'TrainTicket' }],
    };
    const mapped = mapRecognizeResult(res);
    expect(mapped.items).toHaveLength(2);
    expect(mapped.skipped).toHaveLength(1);
    expect(mapped.requestId).toBe('a1b2c3d4-0000-1111-2222-333344445555');
    expect(mapped.totalPdfCount).toBe(3);
    expect(mapped.items.map((i) => i.page)).toEqual([1, 2]);
  });

  it('空响应 / 畸形响应不抛错，返回空结果（由调用方给 42208）', () => {
    expect(mapRecognizeResult({}).items).toEqual([]);
    expect(mapRecognizeResult(null).items).toEqual([]);
    expect(mapRecognizeResult({ MixedInvoiceItems: 'nope' }).items).toEqual([]);
  });
});
