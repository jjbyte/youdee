import { cx, formatMoney, formatQty, formatRate, EM_DASH } from '@/lib/format';

type Tone = 'default' | 'save' | 'loss' | 'muted' | 'weak' | 'strong';

const TONE: Record<Tone, string> = {
  default: '',
  save: 'num--save',
  loss: 'num--loss',
  muted: 'num--muted',
  weak: 't-3',
  strong: 'fw-semi',
};

export interface MoneyProps {
  value: string | number | null | undefined;
  /** 单价最多 2 位；小计/合计强制 2 位 */
  decimals?: number;
  /** 货币符号只在列头出现一次，单元格内不重复 */
  symbol?: boolean;
  /** 单位（㎡ / 根/天），用于屏幕阅读器补全 */
  unit?: string | null;
  tone?: Tone;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** 缺失时的解释（hover 提示） */
  emptyHint?: string;
}

const SIZE: Record<NonNullable<MoneyProps['size']>, string> = {
  xs: 't-2xs',
  sm: 't-xs',
  md: 't-sm',
  lg: 't-md',
  xl: 't-xl',
};

/** 金额：tabular-nums + 右对齐 + 千分位 + 真负号（§B.7） */
export function Money({
  value,
  decimals = 2,
  symbol = false,
  unit,
  tone = 'default',
  size = 'md',
  className,
  emptyHint,
}: MoneyProps) {
  const text = formatMoney(value, { decimals, symbol });
  const isMissing = text === EM_DASH;
  const spoken = isMissing
    ? '没有数'
    : `${formatMoney(value, { decimals, symbol: false })} 元${unit ? `每${unit}` : ''}`;
  return (
    <span
      className={cx('num', SIZE[size], TONE[isMissing ? 'muted' : tone], className)}
      aria-label={spoken}
      title={isMissing ? emptyHint : undefined}
    >
      {text}
    </span>
  );
}

/** 数量：整数不带小数点 */
export function Qty({
  value,
  unit,
  className,
}: {
  value: string | number | null | undefined;
  unit?: string | null;
  className?: string;
}) {
  const text = formatQty(value);
  return (
    <span className={cx('num', className)} aria-label={`${text}${unit ? ` ${unit}` : ''}`}>
      {text}
    </span>
  );
}

/** 比率：0.415 → 41.5%，0 分母时显示 — 而不是 0% */
export function Rate({
  value,
  tone = 'default',
  className,
}: {
  value: string | number | null | undefined;
  tone?: Tone;
  className?: string;
}) {
  const text = formatRate(value);
  return (
    <span
      className={cx('num', TONE[text === EM_DASH ? 'muted' : tone], className)}
      aria-label={text === EM_DASH ? '毛利率不成立' : text}
    >
      {text}
    </span>
  );
}
