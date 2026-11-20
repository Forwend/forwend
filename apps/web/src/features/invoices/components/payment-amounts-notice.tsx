import Link from "next/link";
import { RECONCILIATION_STATES } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceOption } from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { amountText } from "@/shared/lib/money";

export interface PaymentAmountsNoticeProps {
  options: readonly Pick<
    InvoiceOption,
    "optionId" | "amounts" | "chainId" | "symbol" | "decimals"
  >[];
  detailsHref?: string;
  showVerification?: boolean;
  returnsShownFor?: string; // its money line already shows the return
}

export function PaymentAmountsNotice({
  options,
  detailsHref,
  showVerification = true,
  returnsShownFor,
}: PaymentAmountsNoticeProps) {
  const review =
    showVerification &&
    options.some(
      ({ amounts }) =>
        amounts?.hasPolicyException ||
        amounts?.reconciliationStatus === RECONCILIATION_STATES.review ||
        (amounts?.unreconciled && !amounts.reconciliationStatus),
    );
  const returns = options.filter(
    (option) =>
      option.optionId !== returnsShownFor &&
      option.amounts &&
      BigInt(option.amounts.observedRefunded) > 0n,
  );
  if (!review && returns.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-2 text-sm">
      {review ? (
        <p className="text-warning">
          {COPY.reconciliationNeeded}
          {detailsHref ? (
            <>
              {" "}
              <Link
                href={detailsHref}
                className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                {COPY.verificationDetails}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {returns.map((option) => {
        const amounts = option.amounts;
        if (!amounts) return null;
        const units = BigInt(amounts.observedRefunded);
        const amount = amountText(units, option);
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
