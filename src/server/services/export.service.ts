/**
 * 报价单 Excel 导出。
 *
 * 客户版与内部版**不共用列定义**，是两份独立的列数组，而不是同一个表加个 hideCost 开关。
 * 理由：开关总会在某次「先隐藏后合并单元格」的改动后失效，而失效的后果是把成本发给客户。
 * 另外下发前做一次自检：客户版里出现成本/毛利/cost/profit/margin 任一命中就 500 中止。
 *
 * **客户版的版式来自 `domain/customer-sheet.ts`，与打印/PDF 共用同一份模型。**
 * 客户原话「打印出来的页面要跟 EXCEL 保持一致」：只要两边各自写死列和抬头，就一定会漂移，
 * 而且要等到客户把 PDF 和 Excel 并排放在一起才会被发现。
 */
import ExcelJS from 'exceljs';
import { parseAmount } from '@/domain/money';
import {
  SHEET_OPTIONS_DEFAULT,
  buildCustomerSheet,
  type SheetOptions,
} from '@/domain/customer-sheet';
import { AppError } from '../http';
import { quoteDetail } from './quote.service';
import { getCompany } from './settings.service';

const FORBIDDEN = ['成本', '毛利', '加价', 'cost', 'profit', 'margin'];

export interface ExportResult {
  buffer: Buffer;
  filename: string;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } } };
  });
}

const THIN = { style: 'thin' as const, color: { argb: 'FFE4E7EC' } };

export async function exportQuoteXlsx(
  quoteId: string,
  view: 'customer' | 'internal',
  sheetOptions: SheetOptions = SHEET_OPTIONS_DEFAULT,
): Promise<ExportResult> {
  const quote = await quoteDetail(quoteId);
  const company = await getCompany();
  const isInternal = view === 'internal';

  const wb = new ExcelJS.Workbook();
  wb.creator = company.name || '有底';
  wb.created = new Date();

  if (isInternal) {
    writeInternal(wb, quote, company);
  } else {
    writeCustomer(wb, quote, company, sheetOptions);
  }

  if (!isInternal) {
    // 自检：客户版物理上不含成本列，若命中敏感词说明有人把列加回来了，宁可 500 也不发出去
    const ws = wb.worksheets[0]!;
    let dirty: string | null = null;
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const text = typeof cell.value === 'string' ? cell.value.toLowerCase() : '';
        if (!text) return;
        const hit = FORBIDDEN.find((w) => text.includes(w.toLowerCase()));
        if (hit && !dirty) dirty = hit;
      });
    });
    if (dirty) {
      console.error('[export] 客户版命中敏感词，已中止导出', { quoteId, word: dirty });
      throw new AppError(50001, '客户版导出内容自检未通过，已中止。请联系管理员。', 500);
    }
  }

  const suffix = isInternal ? '内部版' : '客户版';
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${quote.quote_no}-v${quote.version}-${suffix}.xlsx` };
}

type Quote = Awaited<ReturnType<typeof quoteDetail>>;

/** 客户版：列、抬头、分组、合计全部来自 domain/customer-sheet */
function writeCustomer(
  wb: ExcelJS.Workbook,
  quote: Quote,
  company: Awaited<ReturnType<typeof getCompany>>,
  opts: SheetOptions,
): void {
  const sheet = buildCustomerSheet(
    {
      quoteNo: quote.quote_no,
      version: quote.version,
      customerName: quote.customer_name,
      eventName: quote.event_name,
      eventDate: quote.event_date,
      validUntil: quote.valid_until,
      taxStatement: quote.tax_statement as 'inclusive' | 'exclusive',
      discountAmount: quote.discount_amount,
      totalPrice: quote.total_price,
      note: quote.note,
      items: quote.items
        .filter((i) => i.is_visible_to_customer)
        .map((i) => ({
          name: i.item_name_snapshot,
          spec: i.spec_snapshot,
          unit: i.unit_snapshot,
          qty: String(i.qty),
          unitPrice: String(i.sale_unit_price),
          amount: String(i.line_price),
          remark: i.remark,
          category: i.category_snapshot,
        })),
    },
    company,
    opts,
  );

  const ws = wb.addWorksheet('报价单', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = sheet.columns.map((c) => ({ width: c.width }));
  const colCount = sheet.columns.length;

  // ── 抬头 ──
  const title = ws.addRow([sheet.title]);
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(title.number, 1, title.number, colCount);

  const sub = ws.addRow([sheet.subtitle]);
  sub.font = { size: 10, color: { argb: 'FF667085' } };
  sub.alignment = { horizontal: 'center' };
  ws.mergeCells(sub.number, 1, sub.number, colCount);

  const splitAt = Math.max(1, Math.floor(colCount / 2));
  for (const [left, right] of sheet.meta) {
    const r = ws.addRow([left, ...Array(Math.max(0, colCount - 1)).fill('')]);
    if (right) r.getCell(splitAt + 1).value = right;
    if (colCount > 2) {
      ws.mergeCells(r.number, 1, r.number, splitAt);
      ws.mergeCells(r.number, splitAt + 1, r.number, colCount);
    }
  }
  ws.addRow([]);

  // ── 表头 ──
  const header = ws.addRow(sheet.columns.map((c) => c.header));
  styleHeader(header);

  // ── 明细（含分组行）──
  for (const g of sheet.groups) {
    if (g.title) {
      const gr = ws.addRow([g.title, ...Array(Math.max(0, colCount - 1)).fill('')]);
      gr.font = { bold: true };
      gr.alignment = { horizontal: 'left' };
      gr.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
        cell.border = { bottom: THIN };
      });
      ws.mergeCells(gr.number, 1, gr.number, colCount);
    }
    for (const row of g.rows) {
      const values = sheet.columns.map((c) => {
        switch (c.key) {
          case 'no':
            return row.no;
          case 'name':
            return row.name;
          case 'spec':
            return row.spec;
          case 'unit':
            return row.unit;
          case 'qty':
            return row.qty === '' ? '' : Number(row.qty);
          case 'unitPrice':
            return row.unitPrice === null ? '' : Number(row.unitPrice);
          case 'amount':
            return Number(row.amount);
        }
      });
      const r = ws.addRow(values);
      r.alignment = { vertical: 'middle' };
      sheet.columns.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        cell.alignment = { vertical: 'middle', horizontal: c.align };
        if (c.money) cell.numFmt = '#,##0.00';
        cell.border = { bottom: THIN };
      });
    }
  }

  // ── 合计 / 优惠 ──
  ws.addRow([]);
  const amountCol = sheet.columns.findIndex((c) => c.key === 'amount') + 1;
  const labelCol = Math.max(1, amountCol - 2);

  /**
   * 值必须写进合并区的**左上角**那一格：ExcelJS 的 mergeCells 只保留左上角的值，
   * 先写在第 5 格再合并，标签会静默消失——导出的表里只剩一个金额，没人知道它是什么。
   */
  /**
   * 优惠行必须在合计**之上**：合计是折后金额，先打合计再打「优惠 −1000」，
   * 客户会拿合计再减一次，算出来少一千。
   */
  if (sheet.discount) {
    const dr = ws.addRow([]);
    const dl = dr.getCell(1);
    dl.value = sheet.discount.label;
    dl.alignment = { horizontal: 'right' };
    const dc = dr.getCell(amountCol);
    dc.value = -Number(sheet.discount.amount);
    dc.numFmt = '#,##0.00';
    dc.alignment = { horizontal: 'right' };
    if (labelCol > 1) ws.mergeCells(dr.number, 1, dr.number, labelCol);
  }

  const totalRow = ws.addRow([]);
  totalRow.font = { bold: true };
  const totalLabelCell = totalRow.getCell(1);
  totalLabelCell.value = sheet.totalLabel;
  totalLabelCell.alignment = { horizontal: 'right' };
  const totalCell = totalRow.getCell(amountCol);
  totalCell.value = Number(sheet.totalAmount);
  totalCell.numFmt = '#,##0.00';
  totalCell.alignment = { horizontal: 'right' };
  if (labelCol > 1) ws.mergeCells(totalRow.number, 1, totalRow.number, labelCol);

  // ── 说明 / 页脚 ──
  if (sheet.note) {
    ws.addRow([]);
    const nr = ws.addRow(['报价说明', sheet.note]);
    nr.font = { size: 10 };
    ws.mergeCells(nr.number, 2, nr.number, colCount);
    nr.alignment = { vertical: 'top', wrapText: true };
  }

  ws.addRow([]);
  const taxRow = ws.addRow([sheet.taxLine]);
  taxRow.font = { size: 10, color: { argb: 'FF667085' } };
  ws.mergeCells(taxRow.number, 1, taxRow.number, colCount);

  for (const line of sheet.footer) {
    const fr = ws.addRow([line]);
    fr.font = { size: 10, color: { argb: 'FF667085' } };
    ws.mergeCells(fr.number, 1, fr.number, colCount);
  }
}

/** 内部版：含成本的复盘文件，列与客户版不同（这里保留两列「参考最低价 / 高于最低价」的语义位） */
function writeInternal(
  wb: ExcelJS.Workbook,
  quote: Quote,
  company: Awaited<ReturnType<typeof getCompany>>,
): void {
  const columns: Array<{ header: string; key: string; width: number; money?: boolean }> = [
    { header: '序号', key: 'no', width: 6 },
    { header: '项目', key: 'name', width: 32 },
    { header: '规格 / 说明', key: 'spec', width: 26 },
    { header: '单位', key: 'unit', width: 8 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '单价', key: 'sale', width: 14, money: true },
    { header: '小计', key: 'linePrice', width: 16, money: true },
    { header: '供应商', key: 'supplier', width: 22 },
    { header: '成本单价', key: 'costUnit', width: 14, money: true },
    { header: '成本小计', key: 'lineCost', width: 16, money: true },
    { header: '利润', key: 'lineProfit', width: 14, money: true },
    { header: '毛利率', key: 'lineMargin', width: 10 },
    { header: '成本来源', key: 'costSource', width: 12 },
  ];

  const ws = wb.addWorksheet('报价单', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ width: c.width }));

  const titleRow = ws.addRow([company.name || '报价单']);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, columns.length);

  ws.addRow([`报价单号：${quote.quote_no}  V${quote.version}`, '', `报价有效期：${quote.valid_until}`]);
  ws.addRow([`客户：${quote.customer_name}`, '', `活动：${quote.event_name}`]);
  ws.addRow([
    quote.event_date ? `活动日期：${quote.event_date}` : '',
    '',
    `税口径：${quote.tax_statement === 'inclusive' ? '含税' : '不含税'}`,
  ]);
  ws.addRow([]);

  const header = ws.addRow(columns.map((c) => c.header));
  styleHeader(header);

  quote.items.forEach((item, idx) => {
    const values: Array<string | number> = [
      idx + 1,
      item.item_name_snapshot,
      item.spec_snapshot ?? '',
      item.unit_snapshot,
      item.qty,
      item.sale_unit_price,
      item.line_price,
      item.supplier_name_snapshot ?? '',
      item.cost_unit_price,
      item.line_cost,
      item.line_profit,
      `${(Number(item.line_margin) * 100).toFixed(1)}%`,
      item.cost_source === 'price_book' ? '价格库' : '手填',
    ];
    const row = ws.addRow(values);
    columns.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = '#,##0.00';
    });
  });

  ws.addRow([]);
  const totalRow = ws.addRow(['报价合计 / 成本合计 / 毛利', quote.total_price]);
  totalRow.font = { bold: true };
  totalRow.getCell(2).value = quote.total_price;
  totalRow.getCell(3).value = quote.total_cost;
  totalRow.getCell(4).value = quote.total_profit;
  totalRow.getCell(5).value = `${(Number(quote.margin_rate) * 100).toFixed(1)}%`;

  // 用定点比较是否为 0，不经 Number()：优惠金额也是金额
  if (quote.discount_amount && parseAmount(quote.discount_amount) !== 0n) {
    ws.addRow(['整单优惠', `-${quote.discount_amount}`]);
  }
  if (quote.note) {
    ws.addRow([]);
    ws.addRow(['报价说明', quote.note]);
  }
  if (company.phone || company.address) {
    ws.addRow([]);
    ws.addRow([company.name, [company.address, company.phone].filter(Boolean).join('  ')]);
  }
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
