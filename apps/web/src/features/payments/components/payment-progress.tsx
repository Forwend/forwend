import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import type { PaymentDetail } from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";

type PaymentOption = PaymentDetail["options"][number];

export interface PaymentProgressProps {
  option: PaymentOption;
}

export function PaymentProgress({ option }: PaymentProgressProps) {
  const pending = option.deposits.filter((deposit) => deposit.status === "detected");
  const settlement = option.settlement;
  const settled = option.settlementStatus === "settled";
  const txHash = settled ? settlement?.txHash : (settlement?.receiptTxHash ?? settlement?.txHash);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {pending.map((deposit) => (
        <div key={`${deposit.txHash}:${deposit.logIndex}`} className="flex flex-col gap-1">
          <div role="status">
            <ConfirmingStatus
              blocks={deposit.blocksLeft}
              total={deposit.blocksTotal}
              seconds={deposit.secondsLeft}
            />
          </div>
          <ExplorerLink chainId={option.chainId} txHash={deposit.txHash} named />
        </div>
      ))}
      {settlement || settled ? (
        <section aria-label="Transfer to your wallet" className="flex flex-col gap-1">
          <p className="font-medium text-ink">Transfer to your wallet</p>
          <div role="status" className="text-muted">
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
          </div>
          {txHash ? <ExplorerLink chainId={option.chainId} txHash={txHash} named /> : null}
        </section>
      ) : null}
    </div>
  );
}
