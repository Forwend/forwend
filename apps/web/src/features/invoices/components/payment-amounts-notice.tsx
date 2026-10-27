import { formatTokenAmount } from "@forwend/ui-web";
import Link from "next/link";
import { RECONCILIATION_STATES } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { paymentVerification } from "@/features/invoices/lib/payment-verification";
import type { InvoiceOption } from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";
export interface PaymentAmountsNoticeProps {
  options: readonly Pick<
    InvoiceOption,
    "optionId" | "amounts" | "chainId" | "symbol" | "decimals"
  >[];
  detailsHref?: string;
  showVerification?: boolean;
}
export function PaymentAmountsNotice({
  options,
  detailsHref,
  showVerification = true,
}: PaymentAmountsNoticeProps) {
  const state = paymentVerification(options);
  const returns = options.filter(
    (option) => option.amounts && BigInt(option.amounts.observedRefunded) > 0n,
  );
  const verification = showVerification && state !== RECONCILIATION_STATES.verified;
  if (!verification && returns.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-2 text-sm">
      {verification ? (
        <p className={state === RECONCILIATION_STATES.review ? "text-warning" : "text-muted"}>
          {state === RECONCILIATION_STATES.review
            ? COPY.reconciliationNeeded
            : COPY.verificationPending}
          {detailsHref ? (
            <>
              {" "}
              <Link href={detailsHref} className="text-info underline underline-offset-4">
                View verification details
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {returns.map((option) => {
        const amounts = option.amounts;
        if (!amounts) return null;
        const units = BigInt(amounts.observedRefunded);
        const amount = `${formatTokenAmount({ baseUnits: units, decimals: option.decimals, fractionDigits: exactDigits(units, option.decimals) })} ${option.symbol}`;
        return (
          <div key={option.optionId} className="flex flex-col gap-1">
            <p className="text-muted">{COPY.recordedReturns(amount, chainName(option.chainId))}</p>
            {amounts.lastReturnTxHash ? (
              <p className="flex items-center gap-1 text-muted">
                {COPY.latestReturn}
                <ExplorerLink chainId={option.chainId} txHash={amounts.lastReturnTxHash} named />
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
