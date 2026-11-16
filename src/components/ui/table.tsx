'use client';
import type { ReactNode, Ref, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cx } from '@/lib/format';

/** 表格外壳：1px 边框 + 8px 圆角 + 独立滚动容器 */
export function TableWrap({
  children,
  className,
  maxHeight,
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  maxHeight?: string;
  /**
   * 滚动容器本身。调用方要用它判断"右边还有没有列"（滚动提示），
   * 或者把某一行滚进视野；`ref` 转不进来，所以单独开一个口子。
   */
  scrollRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrollRef}
      className={cx('tbl-wrap', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cx('tbl', className)}>{children}</table>;
}

export interface ColProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

export function Th({ align = 'left', sticky, children, className, ...rest }: ColProps) {
  return (
    <th
      {...rest}
      scope="col"
      className={cx(align === 'right' && 'ta-r', align === 'center' && 'ta-c', sticky && 'col-sticky', className)}
    >
      {children}
    </th>
  );
}

export interface CellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

export function Td({ align = 'left', sticky, children, className, ...rest }: CellProps) {
  return (
    <td
      {...rest}
      className={cx(align === 'right' && 'ta-r', align === 'center' && 'ta-c', sticky && 'col-sticky', className)}
    >
      {children}
    </td>
  );
}

export function TableFoot({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="tbl-foot">
      {left}
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}
