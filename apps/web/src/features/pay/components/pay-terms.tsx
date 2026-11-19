import { CalendarDays, FileDown, Handshake, Hash } from "lucide-react";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import {
  DOCUMENT_KINDS,
  HISTORY_FIELDS,
  INVOICE_PDFS,
} from "@/features/invoices/constants/invoices";
import {
  formatAgreed,
  formatDueDate,
  invoicePdfUrl,
  linesFigures,
} from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { payToken } from "@/features/pay/lib/pay";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { dateTime } from "@/shared/lib/dates";

const ICON = "size-[var(--fw-icon-md)] shrink-0";

export function PayTerms({ invoice, linkToken }: { invoice: Invoice; linkToken: string }) {
  const main = invoice.options.find((o) => o.optionId === invoice.invoiceId);
  const lineToken = main
    ? payToken({ ...invoice, chainId: main.chainId, token: main.token })
    : null;
  const shownToken = payToken(invoice);
  return (
    <div className="order-3 flex min-w-0 flex-col items-start gap-4 lg:gap-5">
      {invoice.title ? (
        <p className="text-base font-medium break-words text-ink">{invoice.title}</p>
      ) : null}
      {invoice.lines.length > 0 && main && lineToken ? (
        <div className="w-full">
          <InvoiceLines
            lines={invoice.lines}
            decimals={lineToken.decimals}
            unit={
              invoice.documentKind === DOCUMENT_KINDS.none || invoice.optionCount > 1
                ? MONEY_COPY.usd
                : lineToken.symbol
            }
            {...linesFigures(
              { ...main, decimals: lineToken.decimals },
              shownToken ? { ...invoice, decimals: shownToken.decimals } : undefined,
            )}
            plain
          />
        </div>
      ) : null}
      {invoice.reference || invoice.agreedValue || invoice.dueDate ? (
        <ul className="flex max-w-full flex-col gap-2.5 text-sm text-muted">
          {invoice.reference ? (
            <li className="flex items-center gap-2.5">
              <Hash aria-hidden className={ICON} />
              <span className="min-w-0 break-words">{COPY.reference(invoice.reference)}</span>
            </li>
          ) : null}
          {invoice.agreedValue ? (
            <li className="flex items-center gap-2.5">
              <Handshake aria-hidden className={ICON} />
              {COPY.agreed(
                formatAgreed(invoice.agreedValue),
                formatDueDate(invoice.agreedValue.date),
              )}
            </li>
          ) : null}
          {invoice.dueDate ? (
            <li className="flex items-center gap-2.5">
              <CalendarDays aria-hidden className={ICON} />
              {COPY.due(formatDueDate(invoice.dueDate))}
            </li>
          ) : null}
        </ul>
      ) : null}
      {invoice.note ? (
        <p className="max-w-prose border-l-2 border-line-strong pl-4 text-sm break-words whitespace-pre-line text-ink sm:text-base">
          {invoice.note}
        </p>
      ) : null}
      {invoice.updates.length > 0 ? (
        <section aria-labelledby="pay-updates" className="flex flex-col gap-1.5 text-sm">
          <h2 id="pay-updates" className="text-xs font-medium text-muted">
            {COPY.updates.title}
          </h2>
          <ul className="flex flex-col gap-1 text-muted">
            {invoice.updates.map((u) => (
              <li key={`${u.at}-${u.field}-${u.from}-${u.to}`}>
                <time dateTime={u.at}>{dateTime(u.at)}</time>
                {" · "}
                {u.field === HISTORY_FIELDS.dueDate
                  ? COPY.updates.dueDate(
                      u.from ? formatDueDate(u.from) : null,
                      u.to ? formatDueDate(u.to) : null,
                    )
                  : u.field === HISTORY_FIELDS.note
                    ? COPY.updates.note
                    : COPY.updates.reference}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {invoice.documentKind !== DOCUMENT_KINDS.none ? (
        <a
          href={invoicePdfUrl(linkToken, INVOICE_PDFS.invoice)}
          className="-mx-1 inline-flex items-center gap-2 rounded-sm px-1 text-sm font-medium text-ink underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <FileDown aria-hidden className={ICON} />
          {COPY.pdfLabel}
        </a>
      ) : null}
    </div>
  );
}
