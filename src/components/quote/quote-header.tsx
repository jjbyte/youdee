'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cx, formatRate, rateToPctInput } from '@/lib/format';
import { PROJECT_TYPE_LABELS, PROJECT_TYPE_ORDER } from '@/lib/labels';
import type { ProjectType, QuoteDetail, TaxBasis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Input, Select } from '@/components/ui/field';
import {
  IconArrowLeft,
  IconCopy,
  IconDownload,
  IconLoading,
  IconLock,
  IconPrinter,
} from '@/components/icons';
import { marginToMultiplier, parsePercentInput } from './quote-shared';

/**
 * 单头（§C.7）。
 *
 * 三个必须做对的：
 *   ① 「类型」下拉放在「口径」之前——因为它决定阈值，阈值决定着色的含义；
 *   ② `口径` 是**真开关**（resolvePrice 的入参），不是页脚的一句注释；
 *   ③ `(≈成本 × 1.667)` **常驻**在毛利率后面。报价员说的「加 40 个点」是成本加价，
 *      真实毛利率只有 28.6%，两者差 11.4 个百分点，一张 10 万的单差一万多。
 *      会造成错误的那一瞬间就是他输入数字的那一瞬间，藏在弹层里的解释等于没有。
 */
export function QuoteHeader({
  quote,
  saveState,
  onRetrySave,
  isAdmin,
  locked,
  onPatch,
  onTaxBasis,
  onPreview,
  onExport,
  onNewVersion,
  onApplyMargin,
  applyingMargin,
  typeMargins = {},
}: {
  quote: QuoteDetail;
  saveState: 'idle' | 'saving' | 'error';
  onRetrySave: () => void;
  isAdmin: boolean;
  locked: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onTaxBasis: (b: TaxBasis) => void;
  onPreview: () => void;
  onExport: (view: 'customer-pdf' | 'customer-xlsx' | 'internal') => void;
  /** 已发出的单唯一能走的路。放在只读横幅里——规则说在哪，按钮就在哪。 */
  onNewVersion?: () => void;
  /** 把已有行的对客价按毛利率整体重算（改毛利率只影响之后攒进来的行） */
  onApplyMargin?: () => void;
  applyingMargin?: boolean;
  /** 项目类型 → 默认毛利率（百分数，如 "40"）。没配的类型不出现 */
  typeMargins?: Record<string, string>;
}) {
  const [customer, setCustomer] = useState(quote.customerName);
  const [eventName, setEventName] = useState(quote.eventName);
  const [eventDate, setEventDate] = useState(quote.eventDate ?? '');
  const [marginDraft, setMarginDraft] = useState(
    quote.targetMarginRate ? rateToPctInput(quote.targetMarginRate) : '',
  );
  /**
   * 毛利率可能被别处改掉（选品面板里就能填，攒单时顺手落库）。
   * 单头是同一个数的第二个显示位，不同步就会出现"库里 40%、屏幕上空着"。
   * 依赖只有这个字段：用户正在输入时它不变，所以不会把光标下的内容抹掉。
   */
  useEffect(() => {
    setMarginDraft(quote.targetMarginRate ? rateToPctInput(quote.targetMarginRate) : '');
  }, [quote.targetMarginRate]);
  const [exportOpen, setExportOpen] = useState(false);

  const marginRate = Number(quote.targetMarginRate ?? 0);
  const attachmentCount = 0; // 客户版只带物料图，数字由导出接口给；MVP 先按 0 不渲染

  return (
    <header className="flex flex-col gap-[var(--space-3)]">
      <div className="flex items-center gap-[var(--space-3)] flex-wrap">
        <Link href="/quotes" className="btn btn--icon" aria-label="回报价单列表">
          <IconArrowLeft size={16} />
        </Link>
        <span className="t-sm t-3 num">{quote.quoteNo}</span>
        <span className="t-3">·</span>
        <h1 className="t-lg truncate">
          {quote.customerName} {quote.eventName}
        </h1>
        <Badge tone={quote.status === 'issued' ? 'success' : quote.status === 'void' ? 'neutral' : 'neutral'}>
          {quote.status === 'draft' ? '草稿' : quote.status === 'issued' ? '已发出' : '已作废'}
        </Badge>
        {quote.version > 1 ? <Badge tone="neutral">v{quote.version}</Badge> : null}

        <span className="ml-auto inline-flex items-center gap-[var(--space-2)] t-xs t-3" aria-live="polite">
          {saveState === 'saving' ? (
            <>
              <IconLoading size={16} className="animate-spin" />
              正在保存…
            </>
          ) : saveState === 'error' ? (
            <button type="button" className="btn btn--link t-danger" onClick={onRetrySave}>
              没存上，点这重试
            </button>
          ) : (
            <>草稿已存</>
          )}
        </span>

        <Button variant="secondary" size="sm" icon={<IconPrinter size={16} />} onClick={onPreview}>
          预览客户版
        </Button>

        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            icon={<IconDownload size={16} />}
            onClick={() => setExportOpen((v) => !v)}
            aria-expanded={exportOpen}
            aria-haspopup="menu"
          >
            导出
          </Button>
          {exportOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-[var(--z-dropdown)] cursor-default"
                aria-label="收起导出菜单"
                tabIndex={-1}
                onClick={() => setExportOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 mt-[var(--space-2)] z-[var(--z-dropdown)] panel"
                style={{ width: 300 }}
              >
                <button
                  role="menuitem"
                  type="button"
                  className="nav-item w-full text-left"
                  onClick={() => {
                    setExportOpen(false);
                    onExport('customer-pdf');
                  }}
                >
                  导出客户版 PDF
                </button>
                <button
                  role="menuitem"
                  type="button"
                  className="nav-item w-full text-left"
                  onClick={() => {
                    setExportOpen(false);
                    onExport('customer-xlsx');
                  }}
                >
                  导出客户版 Excel
                </button>
                {attachmentCount > 0 ? (
                  <div className="t-2xs t-3 px-[var(--space-3)] py-[var(--space-1)]">
                    客户版不含供应商报价附件（{attachmentCount} 张）
                  </div>
                ) : null}
                <div className="my-[var(--space-2)] h-px bg-[var(--border)]" />
                <button
                  role="menuitem"
                  type="button"
                  className={cx('nav-item w-full text-left', !isAdmin && 't-3')}
                  disabled={!isAdmin}
                  aria-disabled={!isAdmin}
                  title={!isAdmin ? '内部版含成本，仅管理员可导出' : undefined}
                  onClick={() => {
                    if (!isAdmin) return;
                    setExportOpen(false);
                    onExport('internal');
                  }}
                >
                  <span className="inline-flex items-center gap-[var(--space-2)] w-full">
                    导出内部版（含成本）
                    {!isAdmin ? <IconLock size={16} /> : null}
                  </span>
                </button>
                {!isAdmin ? (
                  <div className="t-2xs t-3 px-[var(--space-3)] py-[var(--space-1)]">
                    内部版含成本，仅管理员可导出
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {locked ? (
        <div className="note note--info">
          <IconLock size={16} />
          <div className="flex items-center gap-[var(--space-3)] flex-wrap">
            <span>这张单已经发出去了。要改，只能复制重报成新版。</span>
            {onNewVersion ? (
              <Button size="sm" variant="secondary" icon={<IconCopy size={16} />} onClick={onNewVersion}>
                复制重报（生成 v{quote.version + 1}）
              </Button>
            ) : null}
            <Link href={`/quotes/${quote.id}/preview`} className="btn btn--link">
              看客户版
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-[var(--space-4)] flex-wrap t-sm">
        <label className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-3">客户</span>
          <Input
            value={customer}
            disabled={locked}
            aria-label="客户名称"
            style={{ width: 160 }}
            onChange={(e) => setCustomer(e.target.value)}
            onBlur={() => customer !== quote.customerName && onPatch({ customerName: customer })}
          />
        </label>
        <span className="t-muted">·</span>
        <label className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-3">活动</span>
          <Input
            value={eventName}
            disabled={locked}
            aria-label="活动名称"
            style={{ width: 220 }}
            onChange={(e) => setEventName(e.target.value)}
            onBlur={() => eventName !== quote.eventName && onPatch({ eventName })}
          />
        </label>
        <span className="t-muted">·</span>
        <label className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-3">活动日</span>
          <Input
            type="date"
            value={eventDate}
            disabled={locked}
            aria-label="活动日期"
            style={{ width: 150 }}
            onChange={(e) => setEventDate(e.target.value)}
            onBlur={() => eventDate !== (quote.eventDate ?? '') && onPatch({ eventDate: eventDate || null })}
          />
        </label>
        <span className="t-muted">·</span>
        {/*
          报价人是**派生信息**，不是可填字段：它来自登录账号，改了就等于改台账署名。
          所以这里是只读文字而不是输入框——看得见"客户手里那份印的是谁"，也改不动。
        */}
        <span className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-3">报价人</span>
          <span className="t-sm">{quote.createdByName ?? '—'}</span>
          {quote.createdByPhone ? (
            <span className="num-code t-xs t-2">{quote.createdByPhone}</span>
          ) : (
            <span className="t-2xs t-3">（账号没填电话，抬头不显示）</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-[var(--space-4)] flex-wrap">
        <label className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-xs t-3">类型</span>
          <Select
            value={quote.projectType ?? ''}
            disabled={locked}
            aria-label="项目类型"
            style={{ width: 168 }}
            onChange={(e) => {
              const t = e.target.value as ProjectType | '';
              /**
               * 换类型 = 换这一类的默认毛利率（客户原话「选了类型毛利率没同步变」）。
               * 只改单头这个数，不动已有行的对客价——所以要重算还点「按毛利率重算」。
               */
              const m = t ? typeMargins[t] : undefined;
              onPatch(
                m
                  ? { projectType: t || null, targetMarginRate: String(Number(m) / 100) }
                  : { projectType: t || null },
              );
            }}
          >
            <option value="">未选（按默认 25%）</option>
            {PROJECT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {PROJECT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>

        <span className="t-muted">·</span>

        <span className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-xs t-3">口径</span>
          <Segmented<TaxBasis>
            ariaLabel="含税口径"
            value={quote.taxStatement}
            options={[
              { value: 'inclusive', label: '含税' },
              { value: 'exclusive', label: '不含税' },
            ]}
            onChange={(b) => {
              if (b !== quote.taxStatement) onTaxBasis(b);
            }}
          />
        </span>

        <span className="t-muted">·</span>

        <label className="inline-flex items-center gap-[var(--space-2)]">
          <span className="t-xs t-3">毛利率</span>
          <Input
            className="num"
            inputMode="decimal"
            value={marginDraft}
            disabled={locked}
            aria-label="整单目标毛利率（百分比）"
            style={{ width: 64, textAlign: 'right' }}
            placeholder="40"
            onChange={(e) => setMarginDraft(e.target.value)}
            onBlur={() => {
              const rate = parsePercentInput(marginDraft);
              if (rate === null || rate <= 0 || rate >= 1) {
                setMarginDraft(
                  quote.targetMarginRate ? rateToPctInput(quote.targetMarginRate) : '',
                );
                return;
              }
              if (String(rate) !== String(quote.targetMarginRate)) onPatch({ targetMarginRate: String(rate) });
            }}
          />
          <span className="t-xs t-3">%</span>
          {/* 常驻，不藏弹层：这一行让「毛利率」和「我该收多少」当场对上 */}
          <span className="t-2xs t-3">(≈成本 × {marginToMultiplier(marginRate)})</span>
        </label>

        {/* 改毛利率只影响「之后」攒进来的行，已有行不会自己动——所以给一个明说的动作。
            没有它，报价员会以为改了毛利率全单就跟着变了，直到客户看到一份没变价的单。 */}
        {quote.items.length > 0 && onApplyMargin ? (
          <button
            type="button"
            className="btn btn--link"
            disabled={locked || !quote.targetMarginRate || applyingMargin}
            onClick={onApplyMargin}
            title={
              quote.targetMarginRate
                ? `把全部 ${quote.items.length} 行的对客价按 ${Math.round(marginRate * 1000) / 10}% 毛利率重算`
                : '先在左边填一个毛利率，才能反推对客价'
            }
          >
            {applyingMargin ? '正在重算…' : '按毛利率重算'}
          </button>
        ) : null}

        <span style={{ flex: 1 }} />

        <span className="t-2xs t-3">
          {quote.taxStatement === 'inclusive'
            ? '本单按含税口径取成本，客户版声明「以上报价为含税价，税率另计」'
            : '本单按不含税口径取成本，客户版声明「以上报价为不含税价，税额另计」'}
        </span>
      </div>

      {quote.marginRate !== null && Number(quote.marginRate) < 0 ? (
        <div className="note note--danger">
          这单是亏的（{formatRate(quote.marginRate)}）。还能出单，但会进自检清单。
        </div>
      ) : null}
    </header>
  );
}
