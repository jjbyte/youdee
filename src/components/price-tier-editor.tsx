'use client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { IconButton } from '@/components/ui/button';
import { IconClose, IconPlus } from '@/components/icons';

export interface TierDraft {
  min: string;
  price: string;
}

/**
 * 阶梯价编辑器。
 *
 * 两个刻意的取舍：
 *   ① 「添加一档」的起始量默认填上一档 +1，不是空着——空着用户得自己算，
 *      而算错一格的结果是这一档永远命中不了，价看着在、其实用不上。
 *   ② 每一档都有独立的 aria-label（第 N 档起始数量 / 单价）。都叫"数量"的话，
 *      读屏用户听到的是四个一模一样的框，没法填。
 */
export function PriceTierEditor({
  tiers,
  onChange,
  hint,
}: {
  tiers: TierDraft[];
  onChange: (next: TierDraft[]) => void;
  hint: string;
}) {
  return (
    <Field label="阶梯价" hint={hint}>
      <div className="flex flex-col gap-[var(--space-2)]">
        {tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-[var(--space-2)]">
            <span className="t-2xs t-3" style={{ width: '28px' }}>
              起
            </span>
            <Input
              className="num"
              value={t.min}
              onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
              aria-label={`第 ${i + 1} 档起始数量`}
            />
            <span className="t-2xs t-3" style={{ width: '28px' }}>
              价
            </span>
            <Input
              className="num"
              value={t.price}
              onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              aria-label={`第 ${i + 1} 档单价`}
            />
            <IconButton label="删掉这一档" onClick={() => onChange(tiers.filter((_, j) => j !== i))}>
              <IconClose size={16} />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          icon={<IconPlus size={16} />}
          onClick={() => {
            const last = tiers[tiers.length - 1];
            const nextMin = last?.min ? String(Number(last.min) + 1) : '1';
            onChange([...tiers, { min: nextMin, price: '' }]);
          }}
        >
          添加一档
        </Button>
      </div>
    </Field>
  );
}
