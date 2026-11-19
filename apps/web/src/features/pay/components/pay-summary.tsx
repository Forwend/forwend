import { Money } from "@forwend/ui-web";
import { DOCUMENT_KINDS } from "@/features/invoices/constants/invoices";
import { invoiceNumber, optionFees } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { Payee } from "@/features/pay/components/payee";
import { TestnetBadge } from "@/features/pay/components/testnet-badge";
import { PayTokenMark } from "@/features/pay/components/token-marks";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { amountText, payeeName } from "@/features/pay/lib/pay";
import type { PayStatus, PayToken } from "@/features/pay/types/pay";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface PaySummaryProps {
  invoice: Invoice;
  token: PayToken;
  pay: PayStatus;
  picking: boolean;
}

export function PaySummary({ invoice, token, pay, picking }: PaySummaryProps) {
  const number = invoiceNumber(invoice.number);
  const amount = BigInt(invoice.amount);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const partial = pay.canSend && pay.received > 0n;
  const shown = partial ? pay.remaining : amount;
  const fees = optionFees(invoice);
  const unit = picking ? { ...token, symbol: MONEY_COPY.usd } : token;
  const units = (n: bigint) => amountText(n, unit);
  // Every option carries the same fees, so they read in USD before a pick too.
  const feeLine =
    fees.clientPays && fees.total > 0n && !partial
      ? COPY.withFees(units(fees.net), [
          ...(fees.network > 0n ? [COPY.networkFee(units(fees.network))] : []),
          ...(fees.platform > 0n ? [COPY.platformFee(units(fees.platform))] : []),
        ])
      : null;
  return (
    <section aria-labelledby="pay-amount" className="order-1 flex min-w-0 flex-col gap-5 lg:gap-6">
      <div className="flex items-center justify-between gap-3">
        <Payee
          name={payeeName(invoice) ?? COPY.noIssuer}
          subtitle={
            invoice.documentKind === DOCUMENT_KINDS.none
              ? COPY.checkout
              : invoice.issuer
                ? COPY.invoice(number)
                : COPY.request(number)
          }
          brand={invoice.brand}
        />
        {invoice.livemode ? null : <TestnetBadge />}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 id="pay-amount" className="text-sm text-muted">
          {done
            ? COPY.amountPaid
            : partial
              ? COPY.leftToPay
              : pay.canSend
                ? COPY.amountDue
                : COPY.amount}
        </h2>
        <Money
          baseUnits={shown}
          decimals={token.decimals}
          fractionDigits={exactDigits(shown, token.decimals)}
          token={picking ? MONEY_COPY.usd : token.symbol}
          className="min-w-0 text-amount-lg text-ink"
        />
        <p
          className={`flex items-center gap-2 text-sm text-muted ${picking && !feeLine ? "invisible" : ""}`}
        >
          {picking && feeLine ? (
            feeLine
          ) : (
            <>
              <PayTokenMark chainId={invoice.chainId} symbol={token.symbol} />
              {COPY.on(chainName(invoice.chainId))}
            </>
          )}
        </p>
        {feeLine && !picking ? <p className="text-sm text-muted">{feeLine}</p> : null}
      </div>
    </section>
  );
}
