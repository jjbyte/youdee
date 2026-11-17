import { describe, expect, it } from 'vitest';
import {
  AMOUNT_TOLERANCE_CENTS,
  INVOICE_STATUSES,
  applyDetectedSign,
  detectRedLetter,
  isInvoiceStatus,
  isSameInvoice,
  normalizeInvoiceCode,
  normalizeInvoiceNo,
  normalizeTaxNo,
  parseInvoiceInput,
  parseIssuedOn,
  parseOcrMoney,
  reconcileAmounts,
  signAmounts,
  toCents,
} from '@/domain/invoice-record';
import {
  CONTRACT_STATUSES,
  DEFAULT_CONTRACT_STATUS,
  LEGACY_CONTRACT_STATUS,
  contractStatusLabel,
  isContractStatus,
} from '@/domain/contract';

describe('金额容差（0.01 元 = 1 分）', () => {
  it('容差常量是 1 分，且判定用 BigInt 不碰浮点', () => {
    expect(AMOUNT_TOLERANCE_CENTS).toBe(1n);
    // 0.1 + 0.2 在浮点里是 0.30000000000000004；分口径必须干净
    expect(toCents('0.10')! + toCents('0.20')!).toBe(30n);
  });

  it('三项齐全且完全自洽 → ok，无告警', () => {
    const r = reconcileAmounts({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' });
    expect(r.check).toBe('ok');
    expect(r.warning).toBeNull();
    expect(r.amounts).toEqual({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' });
  });

  it('差正好 0.01 元仍在容差内 → ok（边界）', () => {
    const r = reconcileAmounts({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.01' });
    expect(r.check).toBe('ok');
  });

  it('差 0.02 元 → mismatch，但仍给原值 + 一句人话告警（不拒绝入库）', () => {
    const r = reconcileAmounts({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.02' });
    expect(r.check).toBe('mismatch');
    expect(r.amounts.totalAmount).toBe('1130.02');
    expect(r.warning).toContain('0.02');
    expect(r.warning).toContain('已标黄');
  });
});

describe('缺项推导（derived）', () => {
  it('缺不含税金额 → 用「价税合计 − 税额」推', () => {
    const r = reconcileAmounts({ amount: null, taxAmount: '130.00', totalAmount: '1130.00' });
    expect(r.check).toBe('derived');
    expect(r.amounts.amount).toBe('1000.00');
    expect(r.warning).toContain('推算');
  });

  it('缺税额 → 用「价税合计 − 不含税金额」推（1 分不丢）', () => {
    const r = reconcileAmounts({ amount: '999.99', taxAmount: null, totalAmount: '1130.00' });
    expect(r.check).toBe('derived');
    expect(r.amounts.taxAmount).toBe('130.01');
  });

  it('缺价税合计 → 用「不含税金额 + 税额」推', () => {
    const r = reconcileAmounts({ amount: '1000.00', taxAmount: '130.00', totalAmount: null });
    expect(r.check).toBe('derived');
    expect(r.amounts.totalAmount).toBe('1130.00');
  });

  it('只认出了价税合计 → 不推导、不报错（部分电子票无价税分离是常态）', () => {
    const r = reconcileAmounts({ amount: null, taxAmount: null, totalAmount: '1130.00' });
    expect(r.check).toBe('ok');
    expect(r.amounts).toEqual({ amount: null, taxAmount: null, totalAmount: '1130.00' });
    expect(r.warning).toBeNull();
  });
});

describe('红字票判定与符号归一', () => {
  it('任一项为负 → 红字票（OCR 唯一的负号线索）', () => {
    const d = detectRedLetter({ amounts: { amount: '-1000.00', taxAmount: '-130.00', totalAmount: '-1130.00' } });
    expect(d.redLetter).toBe(true);
    expect(d.reason).toBe('amount_negative');
  });

  it('票面文字含「红字」/「红冲」→ 红字票（不依赖负号）', () => {
    expect(
      detectRedLetter({ title: '增值税普通发票（红字）', amounts: { amount: '1.00', taxAmount: null, totalAmount: null } })
        .redLetter,
    ).toBe(true);
    expect(
      detectRedLetter({ typeLabel: '红冲发票', amounts: { amount: '1.00', taxAmount: null, totalAmount: null } }).redLetter,
    ).toBe(true);
  });

  it('没有任何线索 → 蓝字票', () => {
    const d = detectRedLetter({ amounts: { amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' } });
    expect(d.redLetter).toBe(false);
    expect(d.reason).toBe('heuristic_normal');
  });

  it('红字票归一后三项都是负数（原本已是负数也不出现 -- 得 +）', () => {
    const neg = applyDetectedSign({ amount: '-1000.00', taxAmount: '-130.00', totalAmount: '-1130.00' }, true);
    expect(neg.amounts).toEqual({ amount: '-1000.00', taxAmount: '-130.00', totalAmount: '-1130.00' });
    const pos = applyDetectedSign({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' }, true);
    expect(pos.amounts).toEqual({ amount: '-1000.00', taxAmount: '-130.00', totalAmount: '-1130.00' });
  });

  it('蓝字票保持原符号，但出现负号要告警（可能判错了）', () => {
    const keep = applyDetectedSign({ amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' }, false);
    expect(keep.warning).toBeNull();
    const odd = applyDetectedSign({ amount: '-1000.00', taxAmount: '130.00', totalAmount: '-870.00' }, false);
    expect(odd.warning).toContain('负数');
  });

  it('signAmounts 按票面性质强制重定：红字票 → 负、蓝字票 → 正', () => {
    const amounts = { amount: '1000.00', taxAmount: '130.00', totalAmount: '1130.00' };
    expect(signAmounts(amounts, true)).toEqual({
      amount: '-1000.00',
      taxAmount: '-130.00',
      totalAmount: '-1130.00',
    });
    expect(signAmounts({ amount: '-1000.00', taxAmount: '-130.00', totalAmount: '-1130.00' }, false)).toEqual(amounts);
  });

  it('一对票抵成 0：原票 +1130 与红字票 −1130 直接相加（改「已冲红」标签不再翻符号）', () => {
    const blue = toCents('1130.00')!;
    const red = toCents(signAmounts({ amount: null, taxAmount: null, totalAmount: '1130.00' }, true).totalAmount)!;
    expect(blue + red).toBe(0n);
  });
});

describe('开票日期解析（中文 / 短横 / 斜杠 / 点）', () => {
  it('中文日期 → yyyy-mm-dd', () => {
    expect(parseIssuedOn('2016年04月11日')).toBe('2016-04-11');
    expect(parseIssuedOn('2026年4月1日')).toBe('2026-04-01');
  });

  it('三种常见分隔符都能吃', () => {
    expect(parseIssuedOn('2026-04-11')).toBe('2026-04-11');
    expect(parseIssuedOn('2026/4/11')).toBe('2026-04-11');
    expect(parseIssuedOn('2026.04.11')).toBe('2026-04-11');
  });

  it('全角数字与前后空白也能吃', () => {
    expect(parseIssuedOn(' ２０２６．０４．１１ ')).toBe('2026-04-11');
  });

  it('日历上不存在的那一天必须拒（不能让它悄悄变成 03-02）', () => {
    expect(parseIssuedOn('2026-02-30')).toBeNull();
    expect(parseIssuedOn('2026-13-01')).toBeNull();
  });

  it('认不出返回 null（不阻塞入库，由调用方拼告警）', () => {
    expect(parseIssuedOn('')).toBeNull();
    expect(parseIssuedOn('四月十一日')).toBeNull();
    expect(parseIssuedOn(null)).toBeNull();
  });
});

describe('发票号码 / 代码规范化', () => {
  it('前导零必须保留（0 是号码的一部分，不是可以吃掉的填充）', () => {
    expect(normalizeInvoiceNo('01234567')).toBe('01234567');
    expect(normalizeInvoiceNo('00000012')).toBe('00000012');
  });

  it('空格、横杠、小写字母都被归一，全角数字转半角', () => {
    expect(normalizeInvoiceNo(' 0123-4567 ')).toBe('01234567');
    expect(normalizeInvoiceNo('２６３１２０００００００９８７６５４３２')).toBe('26312000000098765432');
    expect(normalizeInvoiceNo('ab12cd34')).toBe('AB12CD34');
  });

  it('太短 / 太长 / 含非法字符 → null（视为未识别，宁可让人重传）', () => {
    expect(normalizeInvoiceNo('123')).toBeNull();
    expect(normalizeInvoiceNo('12'.repeat(20))).toBeNull();
    expect(normalizeInvoiceNo('1234abcd*')).toBeNull();
    expect(normalizeInvoiceNo(null)).toBeNull();
  });

  it('全电票没有发票代码 → 空串（不是 null，唯一索引不认 NULL 相等）', () => {
    expect(normalizeInvoiceCode('')).toBe('');
    expect(normalizeInvoiceCode(null)).toBe('');
    expect(normalizeInvoiceCode('044001900111')).toBe('044001900111');
  });

  it('税号去掉空格与横杠，长度不够也保留（截断比丢字段好排查）', () => {
    expect(normalizeTaxNo('91310115MA1K38XQ2F')).toBe('91310115MA1K38XQ2F');
    expect(normalizeTaxNo('9131 0115 MA1K 38XQ 2F')).toBe('91310115MA1K38XQ2F');
    expect(normalizeTaxNo('  ')).toBeNull();
  });
});

describe('OCR 金额文本清洗', () => {
  it('货币符号、千分位、全角、尾缀「元」都能吃', () => {
    expect(parseOcrMoney('¥1,234.5')).toBe('1234.50');
    expect(parseOcrMoney('￥ 1 234.50')).toBe('1234.50');
    expect(parseOcrMoney('１００．００')).toBe('100.00');
    expect(parseOcrMoney('1130.00元')).toBe('1130.00');
  });

  it('负号只保留在符号层：清洗结果永远是正值（符号由 signAmounts 决定）', () => {
    expect(parseOcrMoney('-1130.00')).toBe('1130.00');
    expect(parseOcrMoney('−1130.00')).toBe('1130.00');
  });

  it('认不出 → null，绝不返回 0.00', () => {
    expect(parseOcrMoney('')).toBeNull();
    expect(parseOcrMoney('壹仟壹佰叁拾圆整')).toBeNull();
    expect(parseOcrMoney('--')).toBeNull();
    expect(parseOcrMoney(null)).toBeNull();
  });

  it('超过两位小数按 HALF_UP 进位（库层会静默四舍五入，先在这里定下来）', () => {
    expect(parseOcrMoney('1000.005')).toBe('1000.01');
    expect(parseOcrMoney('1000.004')).toBe('1000.00');
  });
});

describe('手工录入解析（parseInvoiceInput）', () => {
  it('必填项缺失逐条报错，不静默补默认', () => {
    const r = parseInvoiceInput({ invoice_no: '123', buyer_name: '', seller_name: '某某公司' }, { partial: false });
    const fields = r.issues.map((i) => i.field);
    expect(fields).toContain('invoice_no');
    expect(fields).toContain('buyer_name');
  });

  it('只填价税合计 → 另两项留空（check=ok），不逼人瞎填', () => {
    const r = parseInvoiceInput(
      {
        invoice_no: '01234567',
        invoice_code: '044001900111',
        buyer_name: '有底文化',
        seller_name: '某某展览',
        total_amount: '1130.00',
      },
      { partial: false },
    );
    expect(r.issues).toEqual([]);
    expect(r.value.total_amount).toBe('1130.00');
    expect(r.value.amount).toBeNull();
    expect(r.value.tax_amount).toBeNull();
    expect(r.value.amount_check).toBe('ok');
  });

  it('三项齐全且差 0.02 → 仍入库但 check=mismatch，并给一句提示', () => {
    const r = parseInvoiceInput(
      {
        invoice_no: '01234567',
        buyer_name: '有底文化',
        seller_name: '某某展览',
        amount: '1000.00',
        tax_amount: '130.00',
        total_amount: '1130.02',
      },
      { partial: false },
    );
    expect(r.value.amount_check).toBe('mismatch');
    expect(r.notes.join()).toContain('0.02');
  });

  it('勾了「红字票」时三项按负数落库（票面性质决定符号）', () => {
    const r = parseInvoiceInput(
      {
        invoice_no: '01234567',
        buyer_name: '有底文化',
        seller_name: '某某展览',
        is_red_letter: true,
        original_invoice_no: '25112000000012345678',
        amount: '1000.00',
        tax_amount: '130.00',
        total_amount: '1130.00',
      },
      { partial: false },
    );
    expect(r.value.amount).toBe('-1000.00');
    expect(r.value.tax_amount).toBe('-130.00');
    expect(r.value.total_amount).toBe('-1130.00');
    // 红字票记下"冲的是哪一张"，之后才能提示把原票标已冲红
    expect(r.value.original_invoice_no).toBe('25112000000012345678');
  });

  it('status 不再决定符号：标「已冲红」不会把金额翻成负数', () => {
    const r = parseInvoiceInput({ status: 'red', amount: '1000.00' }, { partial: true });
    expect(r.value.status).toBe('red');
    expect(r.value.amount).toBe('1000.00');
  });

  it('PATCH 只改金额时按**库里现有的票面性质**定符号（不能默认成蓝票）', () => {
    const r = parseInvoiceInput({ amount: '2000.00' }, { partial: true, redLetterFallback: true });
    expect(r.value.amount).toBe('-2000.00');
  });

  it('显式清空税额不会被缺项推导立刻填回来', () => {
    const r = parseInvoiceInput({ amount: '1000.00', total_amount: '1130.00', tax_amount: null }, { partial: true });
    expect(r.value.tax_amount).toBeNull();
  });

  it('非法状态值 → 400 级错误，不静默回落成 normal', () => {
    const r = parseInvoiceInput({ status: 'void' }, { partial: true });
    expect(r.issues.map((i) => i.field)).toContain('status');
  });

  it('发票状态枚举只有两个值', () => {
    expect(INVOICE_STATUSES.map((s) => s.value)).toEqual(['normal', 'red']);
    expect(isInvoiceStatus('red')).toBe(true);
    expect(isInvoiceStatus('void')).toBe(false);
  });
});

describe('合同状态枚举（五态）', () => {
  it('五个状态、顺序即界面顺序', () => {
    expect(CONTRACT_STATUSES.map((s) => s.value)).toEqual([
      'negotiating',
      'performing',
      'settling',
      'settled',
      'terminated',
    ]);
  });

  it('默认 negotiated=签订中，存量回填 performing=履约中', () => {
    expect(DEFAULT_CONTRACT_STATUS).toBe('negotiating');
    expect(LEGACY_CONTRACT_STATUS).toBe('performing');
  });

  it('非法值一律 false（不静默回落，交给调用方 400）', () => {
    expect(isContractStatus('performing')).toBe(true);
    expect(isContractStatus('done')).toBe(false);
    expect(isContractStatus(null)).toBe(false);
    expect(isContractStatus(undefined)).toBe(false);
  });

  it('中文只在展示层', () => {
    expect(contractStatusLabel('settling')).toBe('结算中');
    expect(contractStatusLabel('whatever')).toBe('签订中');
  });
});

/* ── 判重：两张票是不是同一张（Spec §12-7）───────────────────── */

describe('isSameInvoice', () => {
  it('同代码同号码就是同一张', () => {
    expect(isSameInvoice({ code: '033002100311', no: 'YF20260001' }, { code: '033002100311', no: 'YF20260001' })).toBe(
      true,
    );
  });

  it('同号码、两个代码都非空且不同 → 不是同一张（别家真票，不能被吞）', () => {
    // 纸质票的 8 位号码在各省代码下会重复：这里若判 true，那家的票永远录不进来
    expect(isSameInvoice({ code: '011001900111', no: '88880001' }, { code: '022002900222', no: '88880001' })).toBe(
      false,
    );
  });

  it('存量代码为空、新代码非空、同号码 → 同一张（先没认出代码，重传时认出来了）', () => {
    // 这一条是本次修的 bug：不放宽就会新建一行，金额与税额全部虚增
    expect(isSameInvoice({ code: '', no: 'YF20260001' }, { code: '033002100311', no: 'YF20260001' })).toBe(true);
  });

  it('存量非空、新代码为空、同号码 → 同一张（放宽是双向的）', () => {
    expect(isSameInvoice({ code: '033002100311', no: 'YF20260001' }, { code: '', no: 'YF20260001' })).toBe(true);
  });

  it('号码不同 → 不是同一张（哪怕两边代码都是空）', () => {
    expect(isSameInvoice({ code: '', no: 'YF20260001' }, { code: '', no: 'YF20260002' })).toBe(false);
  });

  it('号码比较用与入库同一条规范化（全角/小写/带横杠都算同一张）', () => {
    expect(isSameInvoice({ code: '', no: 'ｙｆ２０２６０００１' }, { code: '033002100311', no: 'YF-2026 0001' })).toBe(
      true,
    );
  });

  it('空白号码一律不认为重复（没号可比，交给字段校验报错）', () => {
    expect(isSameInvoice({ code: '', no: '' }, { code: '', no: '' })).toBe(false);
  });
});
