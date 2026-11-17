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

  it('票种落 SubType 原值 + 中文描述，启发式判定为蓝字票', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceType).toBe('VatSpecialInvoice');
    expect(r.invoice.invoiceTypeLabel).toBe('增值税专用发票');
    expect(r.invoice.redLetter).toBe(false);
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
    expect(r.invoice.redLetter).toBe(true);
    expect(r.invoice.statusReason).toBe('amount_negative');
    expect(r.invoice.totalAmount).toBe('-1130.00');
    // 三项自洽（绝对值口径比较）
    expect(r.invoice.amountCheck).toBe('ok');
  });

  it('红字票备注里的原发票号码被读出来（这是提示"标原票"的唯一依据）', () => {
    const redWithOriginal = {
      Code: 'OK',
      Type: 16,
      Page: 1,
      SubType: 'VatElectronicInvoiceFull',
      SubTypeDescription: '电子发票（普通发票）',
      SingleInvoiceInfos: {
        VatElectronicInvoiceFull: {
          Number: '25112000000012345678',
          Date: '2026年03月04日',
          Buyer: '有底文化',
          Seller: '某某展览',
          Total: '-1130.00',
          Remark: '被红冲蓝字数电发票号码：25112000000099998888',
        },
      },
    };
    const r = mapInvoiceItem(redWithOriginal);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.redLetter).toBe(true);
    expect(r.invoice.originalInvoiceNo).toBe('25112000000099998888');
  });

  it('红字票但票面没有原票号码 → 照样入账，只是给一句提示', () => {
    const redNoOriginal = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatCommonInvoice',
      SubTypeDescription: '增值税普通发票（红字）',
      SingleInvoiceInfos: {
        VatCommonInvoice: {
          Code: '044001900114',
          Number: '55667788',
          Date: '2026-03-05',
          Buyer: '有底文化',
          Seller: '某某展览',
          Total: '-50.00',
        },
      },
    };
    const r = mapInvoiceItem(redNoOriginal);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.originalInvoiceNo).toBeNull();
    expect(r.invoice.warnings.join()).toContain('原发票号码');
  });

  it('蓝字票不去猜原票号码（备注里有类似字样也不看）', () => {
    const blueWithNoise = {
      Code: 'OK',
      Type: 3,
      Page: 1,
      SubType: 'VatCommonInvoice',
      SubTypeDescription: '增值税普通发票',
      SingleInvoiceInfos: {
        VatCommonInvoice: {
          Code: '044001900115',
          Number: '11224455',
          Date: '2026-03-06',
          Buyer: '有底文化',
          Seller: '某某展览',
          Total: '1130.00',
          Remark: '原发票号码：25112000000099998888',
        },
      },
    };
    const r = mapInvoiceItem(blueWithNoise);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.redLetter).toBe(false);
    expect(r.invoice.originalInvoiceNo).toBeNull();
  });

  it('票面含「红字」但没有负号 → 仍判红字票（OCR 不保证给负号）', () => {
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
    expect(r.invoice.redLetter).toBe(true);
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

/**
 * 电子发票（铁路电子客票）：Type 16，但 `SingleInvoiceInfos.ElectronicTrainTicketFull`
 * 是另一套字段。这三条 fixture 覆盖三种真会遇到的形态：
 *   ① 票价 > 金额（正常一张：含税价与不含税金额都在）；
 *   ② 只有票价（多数字段缺失，靠「票价 − 税额」推不含税）；
 *   ③ 票价为负（退票冲红，接口不给红票标记，只能看负号）。
 */
const RAIL = {
  Code: 'OK',
  Type: 16,
  Page: 1,
  SubType: 'ElectronicTrainTicketFull',
  SubTypeDescription: '电子发票（铁路电子客票）',
  SingleInvoiceInfos: {
    ElectronicTrainTicketFull: {
      TypeOfVoucher: '电子发票（铁路电子客票）',
      ElectronicTicketNum: '26179123456789012345',
      Number: '26339123456789012345',
      Date: '2026年11月02日',
      // 诱饵：乘车日期与开票日期不是同一天，取错字段「按开票日期查」就整列错位
      DateGetOn: '2026年11月05日',
      TimeGetOn: '08:32',
      StationGetOn: '上海虹桥',
      StationGetOff: '南京南',
      TrainNumber: 'G7002',
      Seat: '二等座',
      SeatNumber: '05车12A',
      UserName: '王小明',
      UserID: '320101199001011234',
      Fare: '109.00',
      Total: '100.00',
      Tax: '9.00',
      TaxRate: '9%',
      Buyer: '有底文化传播（上海）有限公司',
      BuyerTaxID: '91310115MA1K38XQ2F',
      // 诱饵：结构体里没有 Seller，塞一个也不该被采信
      Seller: '不该被取到的销售方',
    },
  },
};

describe('电子发票（铁路电子客票）', () => {
  const r = mapInvoiceItem(RAIL);

  it('能映射成功，且票种落在铁客票这一支', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceType).toBe('ElectronicTrainTicketFull');
    expect(r.invoice.invoiceTypeLabel).toBe('电子发票（铁路电子客票）');
  });

  it('号码取 Number（20 位全电号），代码为空串', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.invoiceNo).toBe('26339123456789012345');
    expect(r.invoice.invoiceCode).toBe('');
  });

  it('开票日期取 Date，不是 DateGetOn', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.issuedOn).toBe('2026-11-02');
  });

  it('购买方照取，销售方默认中国铁路集团有限公司（结构体没有 Seller）', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.buyerName).toBe('有底文化传播（上海）有限公司');
    expect(r.invoice.buyerTaxNo).toBe('91310115MA1K38XQ2F');
    expect(r.invoice.sellerName).toBe('中国铁路集团有限公司');
    expect(r.invoice.sellerName).not.toBe('不该被取到的销售方');
    expect(r.invoice.sellerTaxNo).toBeNull();
  });

  it('票价为含税金额：价税合计 = Fare，不含税 = Total', () => {
    if (!r.ok) throw new Error('should map');
    expect(r.invoice.totalAmount).toBe('109.00');
    expect(r.invoice.taxAmount).toBe('9.00');
    expect(r.invoice.amount).toBe('100.00');
    // 三项自洽（100 + 9 = 109），不标黄、不报警
    expect(r.invoice.amountCheck).toBe('ok');
    expect(r.invoice.warnings).toEqual([]);
  });

  it('只有票价时按「票价 − 税额」推不含税，仍自洽', () => {
    const onlyFare = {
      ...RAIL,
      SingleInvoiceInfos: {
        ElectronicTrainTicketFull: { ...RAIL.SingleInvoiceInfos.ElectronicTrainTicketFull, Total: '' },
      },
    };
    const m = mapInvoiceItem(onlyFare);
    if (!m.ok) throw new Error('should map');
    expect(m.invoice.totalAmount).toBe('109.00');
    expect(m.invoice.amount).toBe('100.00');
    // 推出来的数落进三项里而不是凭空补位，所以自洽结论是 ok（不会每张票都报警）
    expect(m.invoice.amountCheck).toBe('ok');
    expect(m.invoice.warnings).toEqual([]);
  });

  it('票价为负（退票）→ 判冲红并三项取负', () => {
    const refund = {
      ...RAIL,
      SingleInvoiceInfos: {
        ElectronicTrainTicketFull: {
          ...RAIL.SingleInvoiceInfos.ElectronicTrainTicketFull,
          Fare: '-109.00',
          Tax: '-9.00',
          Total: '-100.00',
        },
      },
    };
    const m = mapInvoiceItem(refund);
    if (!m.ok) throw new Error('should map');
    expect(m.invoice.redLetter).toBe(true);
    expect(m.invoice.statusReason).toBe('amount_negative');
    expect(m.invoice.totalAmount).toBe('-109.00');
    expect(m.invoice.amountCheck).toBe('ok');
  });

  it('没有号码 → 42208（不落一行搜不到的票）', () => {
    const noNo = {
      ...RAIL,
      SingleInvoiceInfos: { ElectronicTrainTicketFull: { Fare: '109.00', Tax: '9.00' } },
    };
    const m = mapInvoiceItem(noNo);
    expect(m.ok).toBe(false);
    if (m.ok) throw new Error('should reject');
    expect(m.skip.code).toBe(42208);
    expect(m.skip.reason).toBe('invoice_no_unreadable');
  });
});
