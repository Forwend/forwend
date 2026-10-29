import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import type { PaymentDetail } from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";

type PaymentOption = PaymentDetail["options"][number];

export interface PaymentProgressProps {
  option: PaymentOption;
}

/** The transfer of the paid amount to the merchant's wallet; deposits list their own confirmation. */
export function PaymentProgress({ option }: PaymentProgressProps) {
  const settlement = option.settlement;
  const settled = option.settlementStatus === "settled";
  if (!settlement && !settled) return null;
  const txHash = settled ? settlement?.txHash : (settlement?.receiptTxHash ?? settlement?.txHash);
  return (
    <section
      aria-label="Transfer to your wallet"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"
    >
      <span className="flex flex-col">
        <span className="font-medium text-ink">Transfer to your wallet</span>
        <span role="status" className="text-muted">
          {settled ? (
            "In your wallet"
          ) : settlement?.status === "refused" ? (
            "Transfer needs review."
          ) : settlement?.wait === "unresolved" ? (
            "Confirmation unavailable. Check the transaction."
          ) : settlement?.wait === "cap" ? (
            "Daily sending limit reached."
          ) : settlement?.blocksLeft != null || settlement?.status === "sent" ? (
            <ConfirmingStatus blocks={settlement.blocksLeft} seconds={settlement.secondsLeft} />
          ) : settlement?.wait ? (
            "Transfer delayed. Waiting to retry."
          ) : (
            "Preparing transfer"
          )}
        </span>
      </span>
      {txHash ? <ExplorerLink chainId={option.chainId} txHash={txHash} named /> : null}
    </section>
  );
}
