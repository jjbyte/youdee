'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { SHEET_OPTIONS_DEFAULT, buildCustomerSheet, type CustomerSheet } from '@/domain/customer-sheet';
import type { TemplateLayout } from '@/domain/template-layout';
import { PaperSheet } from '@/components/quote/paper-sheet';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { ErrorState, InlineLoading } from '@/components/ui/states';

/**
 * 用**一张真实的报价单**试排这份模板。
 *
 * 为什么不做成「先存后看」：模板的问题只有套上真实数据才看得出来——
 * 抬头那格会不会因为客户名太长而挤成两行、备注列变窄后长备注会不会把行撑爆、
 * 列序换了以后合计还落不落在小计下面。空表预览一个都发现不了。
 *
 * 拿最近一张单来排，是因为它最可能是当前在用的版式需求。
 */
export function TemplatePreview({
  open,
  layout,
  templateName,
  onClose,
}: {
  open: boolean;
  layout: TemplateLayout | null;
  templateName: string;
  onClose: () => void;
}) {
  const [sheet, setSheet] = useState<CustomerSheet | null>(null);
  const [quoteNo, setQuoteNo] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSheet(null);
    setEmpty(null);
    setError(null);
    (async () => {
      try {
        const [company, page] = await Promise.all([api.company(), api.quotes({ limit: 1 })]);
        const first = page.items[0];
        if (!first) {
          if (alive) setEmpty('库里还没有报价单，没有可以试排的数据。先建一张单再回来看。');
          return;
        }
        const quote = await api.quote(first.id);
        if (!alive) return;
        setQuoteNo(`${quote.quoteNo} V${quote.version}`);
        setSheet(
          buildCustomerSheet(
            {
              quoteNo: quote.quoteNo,
              version: quote.version,
              customerName: quote.customerName,
              eventName: quote.eventName,
              eventDate: quote.eventDate,
              validUntil: quote.validUntil,
              taxStatement: quote.taxStatement,
              discountAmount: quote.discountAmount,
              totalPrice: quote.totalPrice,
              note: quote.note,
              supplierName: quote.templateSupplierName,
              quoteDate: quote.quoteDate,
              operatorName: quote.createdByName,
              operatorPhone: quote.createdByPhone,
              items: quote.items
                .filter((l) => l.isVisibleToCustomer)
                .map((l) => ({
                  name: l.itemNameSnapshot,
                  spec: l.specSnapshot,
                  unit: l.unitSnapshot,
                  qty: String(l.qty),
                  unitPrice: String(l.saleUnitPrice),
                  amount: String(l.linePrice),
                  remark: l.remark,
                  category: l.categorySnapshot,
                })),
            },
            company ?? {},
            SHEET_OPTIONS_DEFAULT,
            layout,
          ),
        );
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, layout]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`预览：${templateName}`}
      width="860px"
      footer={
        <>
          <span className="t-2xs t-3" style={{ flex: 1 }}>
            {quoteNo ? `用最近一张单 ${quoteNo} 试排，只影响显示，不会改动这张单。` : ''}
          </span>
          <Button variant="primary" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {error ? <ErrorState message={error} /> : null}
      {empty ? <p className="t-sm t-2">{empty}</p> : null}
      {!error && !empty && !sheet ? <InlineLoading label="正在排客户版…" /> : null}
      {sheet ? (
        <div className="paper-wrap" style={{ minWidth: 0 }}>
          <PaperSheet sheet={sheet} />
        </div>
      ) : null}
    </Modal>
  );
}
