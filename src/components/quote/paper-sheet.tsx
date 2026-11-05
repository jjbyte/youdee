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
              <th key={c.key} scope="col" className={c.align === 'right' ? 'num' : undefined}>
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
                  <td key={c.key} className={c.align === 'right' ? 'num' : c.align === 'center' ? 'mid' : undefined}>
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
              <td colSpan={colCount - 1} className="num">
                {sheet.discount.label}
              </td>
              <td className="num">{formatMoney(`-${sheet.discount.amount}`)}</td>
            </tr>
          ) : null}
          <tr className="paper-sum paper-sum--total">
            <td colSpan={colCount - 1} className="num">
              {sheet.totalLabel}
            </td>
            <td className="num">{formatMoney(sheet.totalAmount)}</td>
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
