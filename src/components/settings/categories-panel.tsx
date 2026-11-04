'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Category } from '@/lib/types';
import { ErrorState, InlineLoading, Note } from '@/components/ui/states';

/**
 * 分类字典（§C.9）：两棵树，各 8 类，**不设「其他」**。
 *
 * 物料和人不会互相归类（把「主持人」拖进「印刷物料」是荒谬的）。
 * 「其他」会变成一个什么都往里扔的垃圾桶，半年后分类就废了——真的出现第 9 类就让客户自己加一类。
 *
 * 单位字典只是一张 11 项枚举表，**不含任何换算系数**：
 * 折算系数是每个物料自己的规格事实（这一款 LED 箱和那一款不一样），不是全公司统一的常量。
 */
export function CategoriesPanel() {
  const [material, setMaterial] = useState<Category[] | null>(null);
  const [personnel, setPersonnel] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.categories('material'), api.categories('personnel')])
      .then(([m, p]) => {
        setMaterial(Array.isArray(m) ? m : (m.material ?? []));
        setPersonnel(Array.isArray(p) ? p : (p.personnel ?? []));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!material || !personnel) return <InlineLoading label="正在读分类…" />;

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-5)]">
        <Tree title="物料树" hint="item_type = material" nodes={material} />
        <Tree title="人员树" hint="item_type = personnel · 计价方式是 unit_mode" nodes={personnel} />
      </div>

      <Note tone="neutral">
        改名 / 增删 / 排序暂时只在库里改（接口还没有写口）。这一页现在只读——
        与其给你一个点了不生效的输入框，不如说清楚现在改不了。
      </Note>
    </div>
  );
}

function Tree({ title, hint, nodes }: { title: string; hint: string; nodes: Category[] }) {
  return (
    <div className="panel">
      <div className="fw-semi t-sm">{title}</div>
      <div className="t-2xs t-3 mb-[var(--space-3)] num">{hint}</div>
      {nodes.length === 0 ? (
        <p className="t-xs t-3">这一类还没有数据。分类由初始化脚本写入，不在界面上建。</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-1)]">
          {nodes.map((c) => (
            <li key={c.id}>
              <div className="flex items-center gap-[var(--space-2)] py-[var(--space-1)]">
                <span className="t-sm">{c.name}</span>
                {typeof c.itemCount === 'number' ? (
                  <span className="num t-2xs t-3">{c.itemCount}</span>
                ) : null}
                <span style={{ flex: 1 }} />
                <span className="t-2xs t-3">{c.effectivePricingNature}</span>
              </div>
              {c.children && c.children.length > 0 ? (
                <ul className="ml-[var(--space-4)]">
                  {c.children.map((ch) => (
                    <li key={ch.id} className="flex items-center gap-[var(--space-2)] py-[2px]">
                      <span className="t-xs t-2">{ch.name}</span>
                      {typeof ch.itemCount === 'number' ? (
                        <span className="num t-2xs t-3">{ch.itemCount}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
