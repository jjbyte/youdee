'use client';
import { formatMoney } from '@/lib/format';
import { sheetCellText, type CustomerSheet } from '@/domain/customer-sheet';

/**
 * 客户版纸面（HTML）。
 *
 * 只负责把 `CustomerSheet` 画出来——列、抬头、分组、合计全部来自 domain，
 * 与客户版 Excel 是同一份模型。这里**不许**再出现"多加一列""换一个表头文案"，
 * 那些改动一旦只做在 HTML 这一侧，客户把 PDF 和 Excel 并排一看就露馅。
 */
export function PaperSheet({ sheet }: { sheet: CustomerSheet }) {
  const colCount = sheet.columns.length;
  /**
   * 列宽按 Excel 字符宽换算成百分比，配合 `table-layout: fixed`：
   * 一是长备注只在备注列里折行，不会把金额列压成两行；
   * 二是浏览器怎么算列宽都不用猜，纸面与 Excel 的列宽比例天然一致。
   */
  const totalWidth = sheet.columns.reduce((a, c) => a + c.width, 0) || 1;
  const widthOf = (w: number) => `${(w / totalWidth) * 100}%`;
  /** 合计要落在「小计」列上；备注在它右边，所以尾部还得补空格子把行填满 */
  const amountIdx = sheet.columns.findIndex((c) => c.key === 'amount');
  const labelSpan = Math.max(1, amountIdx === -1 ? colCount - 1 : amountIdx);
  const tailCells = Math.max(0, colCount - labelSpan - 1);

  return (
    <div className="paper">
      <h1>{sheet.title}</h1>
      <div className="paper-sub">{sheet.subtitle}</div>

      <table className="paper-meta">
        <tbody>
          {sheet.meta.map(([left, right], i) => (
            <tr key={i}>
              <td>{left}</td>
              <td>{right}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="paper-tbl">
        <thead>
          <tr>
            {sheet.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: widthOf(c.width) }}
                className={c.align === 'right' ? 'num' : c.align === 'center' ? 'mid' : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        {sheet.groups.map((g, gi) => (
          <tbody key={g.title ?? `g${gi}`}>
            {g.title ? (
              <tr className="paper-group">
                <td colSpan={colCount}>{g.title}</td>
              </tr>
            ) : null}
            {g.rows.map((row) => (
              <tr key={row.no}>
                {sheet.columns.map((c) => (
                  <td
                    key={c.key}
                    className={
                      c.align === 'right' ? 'num' : c.align === 'center' ? 'mid' : c.wrap ? 'wrap' : undefined
                    }
                  >
                    {sheetCellText(row, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          {sheet.discount ? (
            <tr className="paper-sum">
              <td colSpan={labelSpan} className="num">
                {sheet.discount.label}
              </td>
              <td className="num">{formatMoney(`-${sheet.discount.amount}`)}</td>
              {Array.from({ length: tailCells }, (_, i) => (
                <td key={`d${i}`} aria-hidden="true" />
              ))}
            </tr>
          ) : null}
          <tr className="paper-sum paper-sum--total">
            <td colSpan={labelSpan} className="num">
              {sheet.totalLabel}
            </td>
            <td className="num">{formatMoney(sheet.totalAmount)}</td>
            {Array.from({ length: tailCells }, (_, i) => (
              <td key={`t${i}`} aria-hidden="true" />
            ))}
          </tr>
        </tfoot>
      </table>

      <div className="paper-foot">
        <div>{sheet.taxLine}</div>
        {sheet.note ? <div className="paper-note">{sheet.note}</div> : null}
        {sheet.footer.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
