import { buttonClasses, DetailList, DetailRow, SuccessCheck } from "@forwend/ui-web";
import { ExternalLink, FileDown } from "lucide-react";
import type { ReactNode } from "react";
import { INVOICE_PDFS } from "@/features/invoices/constants/invoices";
import { invoicePdfUrl, isReturnLink } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { Overpaid } from "@/features/pay/components/held-note";
import { OriginMark, PayTokenMark } from "@/features/pay/components/token-marks";
import { EMBED_LAYOUTS } from "@/features/pay/constants/embed";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { amountText, payeeName, receiptDeposits } from "@/features/pay/lib/pay";
import type { EmbedLayout, PayToken } from "@/features/pay/types/pay";
import { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";
import { blockchainName, crossChainOptionRecorded, txLink } from "@/shared/lib/chains";
import { dateTime } from "@/shared/lib/dates";

export interface PaidReceiptProps {
  invoice: Invoice;
  linkToken: string;
  token: PayToken;
  embed?: EmbedLayout;
}

export function PaidReceipt({ invoice, linkToken, token, embed }: PaidReceiptProps) {
  const last = receiptDeposits(invoice).at(-1);
  const tx = last ? txLink(invoice.chainId, last.txHash) : null;
  const name = payeeName(invoice);
  const back =
    embed !== EMBED_LAYOUTS.element && invoice.returnUrl && isReturnLink(invoice.returnUrl)
      ? invoice.returnUrl
      : null;
  const backLabel = back ? COPY.backTo(new URL(back).host) : "";
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 p-4 sm:p-5">
        <span aria-hidden className="shrink-0">
          <SuccessCheck className="size-11" />
        </span>
        <div className="min-w-0">
          <p role="status" className="text-lg font-semibold text-ink">
            {COPY.paid}
          </p>
          {embed ? null : <p className="text-sm text-muted">{COPY.closeHint}</p>}
        </div>
      </div>
      <DetailList className="border-y border-line">
        <DetailRow term={COPY.receiptRows.amount}>
          <Marked mark={<PayTokenMark chainId={invoice.chainId} symbol={token.symbol} />}>
            <span className="font-medium tabular-nums">
              {amountText(BigInt(invoice.amount), token)}
            </span>
          </Marked>
        </DetailRow>
        {name ? <DetailRow term={COPY.receiptRows.to}>{name}</DetailRow> : null}
        {invoice.crossChain?.status === CROSS_CHAIN_STATUSES.success &&
        crossChainOptionRecorded(invoice) ? (
          <DetailRow term={COPY.crossChain.paidWith}>
            <Marked mark={<OriginMark crossChain={invoice.crossChain} />}>
              {COPY.crossChain.paidWithValue(
                amountText(
                  BigInt(invoice.crossChain.deposited ?? invoice.crossChain.amountIn),
                  invoice.crossChain,
                ),
                blockchainName(invoice.crossChain.blockchain),
              )}
            </Marked>
          </DetailRow>
        ) : null}
        {invoice.paidAt ? (
          <DetailRow term={COPY.receiptRows.date}>
            <time dateTime={invoice.paidAt}>{dateTime(invoice.paidAt)}</time>
          </DetailRow>
        ) : null}
        {tx ? (
          <DetailRow term={COPY.receiptRows.transaction}>
            <a
              href={tx.href}
              target="_blank"
              rel="noopener noreferrer"
              title={last?.txHash}
              className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}
            >
              {COPY.viewTx}
              <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
            </a>
          </DetailRow>
        ) : null}
      </DetailList>
      <div className="px-4 pt-4 empty:hidden sm:px-5">
        <Overpaid invoice={invoice} token={token} />
      </div>
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        {back ? (
          // From a full embed the way back leaves the merchant's checkout page, not the frame.
          <a
            href={back}
            target={embed ? "_top" : undefined}
            rel="noopener noreferrer"
            title={backLabel}
            className={`${buttonClasses({ variant: "primary", size: "lg" })} w-full`}
          >
            <span className="truncate">{backLabel}</span>
          </a>
        ) : null}
        <a
          href={invoicePdfUrl(linkToken, INVOICE_PDFS.receipt)}
          className={`${buttonClasses({ variant: back ? "secondary" : "primary", size: "lg" })} w-full`}
        >
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.receiptPdf}
        </a>
      </div>
    </div>
  );
}

function Marked({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="-my-0.5 self-center">{mark}</span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}
