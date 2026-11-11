/**
 * 客户版版面：**打印 / PDF 与客户版 Excel 的唯一版式来源**。
 *
 * 客户原话：「打印出来的页面要跟 EXCEL 保持一致。」
 * 这句话只有一种实现方式——两种输出读同一个模型，而不是两边各写一套然后靠人对齐。
 * 两套实现的漂移是必然的：列少一个、抬头少一行、合计位置不同，而且要等到客户
 * 把 PDF 和 Excel 并排放在一起才会被发现。
 *
 * 因此本文件只做纯计算（不碰 DOM、不碰 ExcelJS）：
 *   输入 → 抬头三行、列定义、分组、合计、优惠、说明、页脚
 *   输出 → 由 `paper-sheet.tsx`（HTML）和 `export.service.ts`（xlsx）各自渲染
 *
 * 客户的「版式」选项（详细/精简、分组、单价、优惠）也是入参：
 * 预览里勾了什么，打印和导出就按什么出——三条路必须看到同一张表。
 */
import { formatMoney, formatQty } from '@/lib/format';
import { fmtAmount, parseAmount } from './money';
import { placeholderNames, type TemplateColumnKey, type TemplateLayout } from './template-layout';

export type SheetLayout = 'detailed' | 'brief';

export interface SheetOptions {
  /** 详细档带「规格 / 说明」列；精简档去掉它（窄纸与快速过目用） */
  layout: SheetLayout;
  /** 按分类分组：每组一行「一、舞美硬体」 */
  grouped: boolean;
  /** 显示单价列（只报金额时关掉） */
  showUnitPrice: boolean;
  /** 显示优惠行与折后合计 */
  showDiscount: boolean;
}

export const SHEET_OPTIONS_DEFAULT: SheetOptions = {
  layout: 'detailed',
  grouped: true,
  showUnitPrice: true,
  showDiscount: true,
};

/** 客户版只关心含税/不含税这一维，不与 lib/types 的 TaxBasis 绑定：domain 不反向依赖展示层 */
export type SheetTaxBasis = 'inclusive' | 'exclusive';

export type SheetAlign = 'left' | 'right' | 'center';

export interface SheetColumn {
  key: TemplateColumnKey;
  header: string;
  /** Excel 列宽（字符数）。HTML 侧按占比换算成百分比，两边列宽比例因此一致 */
  width: number;
  align: SheetAlign;
  money?: boolean;
  /**
   * 这一列允许折行。
   *
   * 只有文字列（项目 / 规格 / 备注）配折行；数字列必须单行——金额被折成两行
   * 后「1,234.00」会断在逗号处，客户会按两笔读。
   */
  wrap?: boolean;
}

/**
 * 列定义。HTML 与 xlsx 都从这一份取，顺序与表头文案只有这里能改。
 *
 * 规格与备注是**两列**：前者是「这个东西多大」，后者是「报价时要记得的事」
 * （含不含运输、含不含调音师）。合成一列叫「规格 / 说明」时，客户分不清
 * 哪句是参数、哪句是条件；一条长备注还会把规格挤没。
 *
 * 备注排在**最后一列（小计之后）**：它是不定长的一段话，只有放在右边缘才有
 * 地方向下折行。夹在规格和小计之间时，一条长备注会把金额列挤成两行，
 * 而金额恰恰是客户唯一必须一眼读准的东西。
 */
export function sheetColumns(opts: SheetOptions): SheetColumn[] {
  const cols: SheetColumn[] = [
    { key: 'no', header: '序号', width: 7, align: 'center' },
    { key: 'name', header: '项目', width: 22, align: 'left', wrap: true },
  ];
  // 规格 16：`1.2m×2.4m 一张 2.88㎡` 这类写法必须整段装得下，窄一格就会断成「2.4 / m」
  if (opts.layout === 'detailed') cols.push({ key: 'spec', header: '规格', width: 16, align: 'left', wrap: true });
  cols.push(
    { key: 'unit', header: '单位', width: 7, align: 'left' },
    { key: 'qty', header: '数量', width: 7, align: 'right' },
  );
  if (opts.showUnitPrice) cols.push({ key: 'unitPrice', header: '单价', width: 14, align: 'right', money: true });
  cols.push({ key: 'amount', header: '小计', width: 15, align: 'right', money: true });
  // 备注放最后：它是不定长的一段话，只有挨着纸边才有地方向下折行
  if (opts.layout === 'detailed') {
    cols.push({ key: 'remark', header: '备注', width: 24, align: 'left', wrap: true });
  }
  return cols;
}

/**
 * 每一列的固有属性：对齐、是否金额、是否折行。
 *
 * 这三项**不允许模板改**。对齐跟着数据类型走——金额被左对齐、序号被右对齐，
 * 客户第一眼就会觉得这张表是临时拼的；折行只给文字列，数字列折成两行后
 * 「1,234.00」会断在逗号处，客户会按两笔读。
 * 模板能改的是：有哪些列、什么顺序、表头写什么、多宽。
 */
const COLUMN_TRAITS: Record<TemplateColumnKey, Pick<SheetColumn, 'align' | 'money' | 'wrap'>> = {
  no: { align: 'center' },
  name: { align: 'left', wrap: true },
  spec: { align: 'left', wrap: true },
  unit: { align: 'left' },
  qty: { align: 'right' },
  unitPrice: { align: 'right', money: true },
  amount: { align: 'right', money: true },
  remark: { align: 'left', wrap: true },
};

/** 模板定的列 → 渲染用的列定义。顺序、表头、列宽来自模板，其余取固有属性 */
function columnsFromLayout(layout: TemplateLayout): SheetColumn[] {
  return layout.columns.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width,
    ...COLUMN_TRAITS[c.key],
  }));
}

export interface SheetItemInput {
  name: string;
  spec?: string | null;
  unit: string;
  qty: string;
  unitPrice: string;
  amount: string;
  /**
   * 行备注。详细档单独一列；精简档省掉了那一列，就接在项目名后面用括号
   * ——省列不能把信息一起省掉。
   */
  remark?: string | null;
  /** 分类名；分组用 */
  category?: string | null;
}

export interface SheetQuoteInput {
  quoteNo: string;
  version: number;
  customerName: string;
  eventName: string;
  eventDate: string | null;
  validUntil: string;
  taxStatement: SheetTaxBasis;
  discountAmount: string;
  totalPrice: string;
  note?: string | null;
  /**
   * 供应商名称 —— 来自建单时选的模板，**已经快照**在单据上。
   * 打印时不再回查模板：模板改了、模板删了，这张单印出来还是当初那家。
   */
  supplierName?: string | null;
  /**
   * 报价日期（= 建单日）。与「活动日期」是两件事：一个是单子什么时候出的，
   * 一个是活动什么时候办。客户对账时认的是前者。
   */
  quoteDate?: string | null;
  /**
   * 报价人（谁做的这张单）与他的电话。
   *
   * 客户拿单子最先问的是「这个桁架几米」，接电话的得是当初报价的那个人。
   * 公司电话解决不了这件事——打过去报单号，对方还得再转一次。
   * 两个都没有时（老账号没填电话、创建人已删）整行不出，不留一行空的「报价人：」。
   */
  operatorName?: string | null;
  operatorPhone?: string | null;
  items: SheetItemInput[];
}

export interface SheetRow {
  no: number;
  name: string;
  spec: string;
  /** 详细档的独立备注列；精简档为 ''（已折进 name） */
  remark: string;
  unit: string;
  qty: string;
  unitPrice: string | null;
  amount: string;
}

export interface SheetGroup {
  /** 「一、舞美硬体」；不分组时为 null */
  title: string | null;
  rows: SheetRow[];
}

/** 抬头里的一格。colSpan=2 表示这一行只有它，占满整宽 */
export interface SheetMetaCell {
  text: string;
  colSpan: 1 | 2;
  align: SheetAlign;
  bold?: boolean;
}

export interface CustomerSheet {
  title: string;
  subtitle: string;
  /**
   * 抬头行，每行一到两格。
   *
   * 从「三行固定的左/右两栏」改成网格，是因为模板允许管理员在 Excel 里
   * 调抬头排布：一行放一个字段、两个字段、换顺序、插一行固定文字。
   * 没有模板时这里仍然是原来的四到五行、每行两格，输出与改造前一致。
   */
  metaRows: SheetMetaCell[][];
  columns: SheetColumn[];
  groups: SheetGroup[];
  totalLabel: string;
  totalAmount: string;
  discount: { label: string; amount: string } | null;
  /** 含税口径声明，页脚第一行 */
  taxLine: string;
  note: string | null;
  /** 页脚：公司名 + 联系方式 */
  footer: string[];
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const TAX_LABEL: Record<string, string> = { inclusive: '含税', exclusive: '不含税' };

export function sheetTaxLine(tax: SheetTaxBasis): string {
  return tax === 'inclusive' ? '以上报价为含税价，税率另计' : '以上报价为不含税价，税额另计';
}

interface MetaCtx {
  quote: SheetQuoteInput;
  company: { name?: string | null; address?: string | null; phone?: string | null };
}

/** 抬头占位符 → 实际值。没认出来的一律空串：宁可少印，也不把 {{xxx}} 印到客户脸上 */
function metaValue(name: string, { quote, company }: MetaCtx): string {
  switch (name) {
    case '报价单号':
      return quote.quoteNo;
    case '版本':
      return `V${quote.version}`;
    case '供应商名称':
      return quote.supplierName?.trim() || '—';
    case '客户名称':
      return quote.customerName;
    case '项目名称':
      return quote.eventName;
    case '报价日期':
      return quote.quoteDate?.trim() || '';
    case '活动日期':
      return quote.eventDate ?? '';
    case '报价有效期':
      return quote.validUntil;
    case '税口径':
      return TAX_LABEL[quote.taxStatement] ?? quote.taxStatement;
    case '报价人':
      return quote.operatorName?.trim() || '';
    case '联系电话':
      return quote.operatorPhone?.trim() || '';
    case '公司名称':
      return company.name?.trim() || '';
    case '公司地址':
      return company.address?.trim() || '';
    case '公司电话':
      return company.phone?.trim() || '';
    default:
      return '';
  }
}

/**
 * 渲染一格抬头。
 *
 * 一格里的占位符**全部**为空、剩下的又只是「活动日期：」这种半截标签时整格返回空——
 * 否则客户会看到一行只有冒号的抬头，像漏填了。这条规则与没有模板时的
 * 「空值不出现」保持一致。
 */
export function renderTemplateText(tpl: string, ctx: MetaCtx): string {
  const names = placeholderNames(tpl);
  if (names.length > 0) {
    const values = names.map((n) => metaValue(n, ctx));
    if (values.every((v) => v === '')) {
      const literal = tpl.replace(/\{\{[^{}]*\}\}/g, '').trim();
      if (literal === '' || /[：:]$/.test(literal)) return '';
    }
  }
  return tpl
    .replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, raw) => metaValue(String(raw).trim(), ctx))
    .trim();
}

export function buildCustomerSheet(
  quote: SheetQuoteInput,
  company: { name?: string | null; address?: string | null; phone?: string | null },
  opts: SheetOptions = SHEET_OPTIONS_DEFAULT,
  layout: TemplateLayout | null = null,
): CustomerSheet {
  /**
   * 有模板时列集合由模板决定，「详细/精简」「显示单价」两个开关随之失效：
   * 模板里没写单价列就是不印，界面上再勾也不该冒出来。
   * 分组与优惠不改列，照常受开关控制。
   */
  const columns = layout ? columnsFromLayout(layout) : sheetColumns(opts);
  const hasCol = (k: TemplateColumnKey) => columns.some((c) => c.key === k);
  const withRemark = hasCol('remark');
  const withUnitPrice = hasCol('unitPrice');

  // 分组：分类名做键，出现顺序即分组顺序（报价员排行序时已经把分类排好了）
  const groups: SheetGroup[] = [];
  if (opts.grouped) {
    const map = new Map<string, SheetItemInput[]>();
    for (const it of quote.items) {
      const k = (it.category ?? '').trim() || '其他';
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    Array.from(map.entries()).forEach(([k, items], i) => {
      groups.push({ title: `${CN_NUM[i] ?? String(i + 1)}、${k}`, rows: items.map((it) => row(it)) });
    });
  } else {
    groups.push({ title: null, rows: quote.items.map(row) });
  }

  // 序号跨组连续，不按组重排：客户按序号数行数，重排会让人以为漏了行
  let no = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      no += 1;
      r.no = no;
    }
  }

  const discountValue = quote.discountAmount && Number(quote.discountAmount) !== 0 ? quote.discountAmount : null;
  /**
   * 关掉「显示原价与折后」时合计要回到**折前**：折后金额配上不显示优惠，
   * 客户看到的是一份自己算不平的单（各行加起来比合计多一千）。
   * 用定点整数求和，不经浮点。
   */
  const lineSum = fmtAmount(quote.items.reduce((a, it) => a + parseAmount(it.amount), 0n));

  const ctx: MetaCtx = { quote, company };
  const operatorName = quote.operatorName?.trim() ?? '';
  const operatorPhone = quote.operatorPhone?.trim() ?? '';

  let title: string;
  let subtitle: string;
  let metaRows: SheetMetaCell[][];

  if (layout) {
    const titleRow = layout.meta.find((r) => r.kind === 'title');
    const subtitleRow = layout.meta.find((r) => r.kind === 'subtitle');
    title = (titleRow ? renderTemplateText(titleRow.cells[0]?.text ?? '', ctx) : '') || company.name?.trim() || '报价单';
    // 模板没写副标题就不印：这一行是版面的一部分，不是必须内容
    subtitle = subtitleRow ? renderTemplateText(subtitleRow.cells[0]?.text ?? '', ctx) : '';
    metaRows = [];
    for (const r of layout.meta) {
      if (r.kind !== 'line') continue;
      const cells: SheetMetaCell[] = [];
      for (const c of r.cells) {
        const text = renderTemplateText(c.text, ctx);
        if (text) cells.push({ text, colSpan: c.colSpan, align: c.align, bold: c.bold });
      }
      if (cells.length) metaRows.push(cells);
    }
  } else {
    title = company.name?.trim() || '报价单';
    subtitle = `${quote.eventName}活动报价 · 单号 ${quote.quoteNo} V${quote.version}`;
    const cell = (text: string, align: SheetAlign = 'left'): SheetMetaCell => ({ text, colSpan: 1, align });
    const supplierName = quote.supplierName?.trim() ?? '';
    const quoteDate = quote.quoteDate?.trim() ?? '';
    /**
     * 抬头四组（+ 有报价人时第五组），一行两格。顺序是按「客户拿到单子会先看什么」排的：
     *   谁出的（单号+供应商）→ 给谁做的（客户+项目）→ 两个日期 → 有效期与口径 → 找谁问。
     * 空值只允许落在**右格**：左格空着会让右边那格看起来像掉了一行。
     * 供应商名称缺失时给破折号而不是留空：空着看起来像漏印。
     * 右格右对齐由数据带着走（原来是 CSS 的 :last-child 干的，模板可改排布后不行了）。
     */
    metaRows = [
      [cell(`报价单号：${quote.quoteNo}  V${quote.version}`), cell(`供应商名称：${supplierName || '—'}`, 'right')],
      [cell(`客户名称：${quote.customerName}`), cell(`项目名称：${quote.eventName}`, 'right')],
      [
        cell(quoteDate ? `报价日期：${quoteDate}` : ''),
        cell(quote.eventDate ? `活动日期：${quote.eventDate}` : '', 'right'),
      ],
      [
        cell(`报价有效期：${quote.validUntil}`),
        cell(`税口径：${TAX_LABEL[quote.taxStatement] ?? quote.taxStatement}`, 'right'),
      ],
    ];
    // 第 5 行只在真有报价人信息时出现：空行会把下面表格往下推一段，而且看着像漏填
    if (operatorName || operatorPhone) {
      metaRows.push([
        cell(operatorName ? `报价人：${operatorName}` : ''),
        cell(operatorPhone ? `联系电话：${operatorPhone}` : '', 'right'),
      ]);
    }
  }

  return {
    title,
    subtitle,
    metaRows,
    columns,
    groups,
    totalLabel: opts.showDiscount ? '报价合计' : '合计',
    totalAmount: opts.showDiscount ? quote.totalPrice : lineSum,
    discount: opts.showDiscount && discountValue ? { label: '整单优惠', amount: discountValue } : null,
    taxLine: sheetTaxLine(quote.taxStatement),
    note: quote.note?.trim() ? quote.note.trim() : null,
    footer: [company.name ?? '', [company.address, company.phone].filter(Boolean).join('  ')].filter(Boolean),
  };

  function row(it: SheetItemInput): SheetRow {
    const remark = it.remark?.trim() ?? '';
    return {
      no: 0,
      // 有独立备注列时，项目名就不再驮一段括号——同一句话印两遍，客户会以为是两条说明
      name: withRemark || !remark ? it.name : `${it.name}（${remark}）`,
      spec: it.spec?.trim() || '—',
      remark: withRemark ? remark : '',
      unit: it.unit,
      qty: it.qty,
      unitPrice: withUnitPrice ? it.unitPrice : null,
      amount: it.amount,
    };
  }
}

/** HTML 侧取一行的显示值（Excel 侧走数字 + 数字格式，不用这个） */
export function sheetCellText(row: SheetRow, key: SheetColumn['key']): string {
  switch (key) {
    case 'no':
      return String(row.no);
    case 'name':
      return row.name;
    case 'spec':
      return row.spec;
    case 'remark':
      return row.remark;
    case 'unit':
      return row.unit;
    case 'qty':
      // 数量按整数显示（18 而不是 18.00）：库里是 numeric(14,2)，直接摆出来是 18.00
      return formatQty(row.qty);
    case 'unitPrice':
      return row.unitPrice === null ? '' : formatMoney(row.unitPrice);
    case 'amount':
      return formatMoney(row.amount);
  }
}
