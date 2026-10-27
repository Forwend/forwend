import { formatTokenAmount } from "@forwend/ui-web";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { Invoice } from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface PaymentAmountsNoticeProps {
  amounts: Invoice["amounts"];
  chainId: number;
  symbol: string;
  decimals: number;
}

export function PaymentAmountsNotice({
  amounts,
  chainId,
  symbol,
  decimals,
}: PaymentAmountsNoticeProps) {
  if (
    !amounts ||
    (!amounts.unreconciled &&
      !amounts.hasPolicyException &&
      BigInt(amounts.observedRefunded) === 0n)
  )
    return null;
  const returned = BigInt(amounts.observedRefunded);
  const amount = `${formatTokenAmount({ baseUnits: returned, decimals, fractionDigits: exactDigits(returned, decimals) })} ${symbol}`;
  return (
    <div role="status" className="flex flex-col gap-2 text-sm">
      {amounts.unreconciled || amounts.hasPolicyException ? (
        <p className="text-warning">{COPY.reconciliationNeeded}</p>
      ) : null}
      {returned > 0n ? (
        <p className="text-muted">{COPY.recordedReturns(amount, chainName(chainId))}</p>
      ) : null}
      {amounts.lastReturnTxHash ? (
        <p className="flex items-center gap-1 text-muted">
          {COPY.latestReturn}
          <ExplorerLink chainId={chainId} txHash={amounts.lastReturnTxHash} named />
        </p>
      ) : null}
    </div>
  );
}
