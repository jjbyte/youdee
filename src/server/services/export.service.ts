/**
 * 报价单 Excel 导出。
 *
 * 客户版与内部版**不共用列定义**，是两份独立的列数组，而不是同一个表加个 hideCost 开关。
 * 理由：开关总会在某次「先隐藏后合并单元格」的改动后失效，而失效的后果是把成本发给客户。
 * 另外下发前做一次自检：客户版里出现成本/毛利/cost/profit/margin 任一命中就 500 中止。
 */
import ExcelJS from 'exceljs';
import { parseAmount } from '@/domain/money';
import { AppError } from '../http';
import { quoteDetail } from './quote.service';
import { getCompany } from './settings.service';

const FORBIDDEN = ['成本', '毛利', '加价', 'cost', 'profit', 'margin'];

const TAX_LABEL: Record<string, string> = { inclusive: '含税', exclusive: '不含税' };

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

export async function exportQuoteXlsx(quoteId: string, view: 'customer' | 'internal'): Promise<ExportResult> {
  const quote = await quoteDetail(quoteId);
  const company = await getCompany();
  const isInternal = view === 'internal';

  const rows = isInternal ? quote.items : quote.items.filter((i) => i.is_visible_to_customer);

  const columns: Array<{ header: string; key: string; width: number; money?: boolean }> = [
    { header: '序号', key: 'no', width: 6 },
    { header: '项目', key: 'name', width: 32 },
    { header: '规格 / 说明', key: 'spec', width: 26 },
    { header: '单位', key: 'unit', width: 8 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '单价', key: 'sale', width: 14, money: true },
    { header: '小计', key: 'linePrice', width: 16, money: true },
  ];
  if (isInternal) {
    columns.push(
      { header: '供应商', key: 'supplier', width: 22 },
      { header: '成本单价', key: 'costUnit', width: 14, money: true },
      { header: '成本小计', key: 'lineCost', width: 16, money: true },
      { header: '利润', key: 'lineProfit', width: 14, money: true },
      { header: '毛利率', key: 'lineMargin', width: 10 },
      { header: '成本来源', key: 'costSource', width: 12 },
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = company.name || '有底';
  wb.created = new Date();
  const ws = wb.addWorksheet('报价单', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ width: c.width }));

  // ── 抬头 ──
  const titleRow = ws.addRow([company.name || '报价单']);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, columns.length);

  ws.addRow([`报价单号：${quote.quote_no}  V${quote.version}`, '', `报价有效期：${quote.valid_until}`]);
  ws.addRow([`客户：${quote.customer_name}`, '', `活动：${quote.event_name}`]);
  ws.addRow([
    quote.event_date ? `活动日期：${quote.event_date}` : '',
    '',
    `税口径：${TAX_LABEL[quote.tax_statement] ?? quote.tax_statement}`,
  ]);
  ws.addRow([]);

  const header = ws.addRow(columns.map((c) => c.header));
  styleHeader(header);

  // ── 明细 ──
  rows.forEach((item, idx) => {
    const values: Array<string | number> = [
      idx + 1,
      item.item_name_snapshot,
      item.spec_snapshot ?? '',
      item.unit_snapshot,
      item.qty,
      item.sale_unit_price,
      item.line_price,
    ];
    if (isInternal) {
      values.push(
        item.supplier_name_snapshot ?? '',
        item.cost_unit_price,
        item.line_cost,
        item.line_profit,
        `${(Number(item.line_margin) * 100).toFixed(1)}%`,
        item.cost_source === 'price_book' ? '价格库' : '手填',
      );
    }
    const row = ws.addRow(values);
    columns.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = '#,##0.00';
    });
  });

  // ── 合计 ──
  ws.addRow([]);
  const totalLabel = isInternal ? '报价合计 / 成本合计 / 毛利' : '报价合计';
  const totalRow = ws.addRow([totalLabel, quote.total_price]);
  totalRow.font = { bold: true };
  if (isInternal) {
    totalRow.getCell(2).value = quote.total_price;
    totalRow.getCell(3).value = quote.total_cost;
    totalRow.getCell(4).value = quote.total_profit;
    totalRow.getCell(5).value = `${(Number(quote.margin_rate) * 100).toFixed(1)}%`;
  }
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

  if (!isInternal) {
    // 自检：客户版物理上不含成本列，若命中敏感词说明有人把列加回来了，宁可 500 也不发出去
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

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
