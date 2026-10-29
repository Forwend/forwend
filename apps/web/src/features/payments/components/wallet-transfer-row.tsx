import { Badge, PAYMENT_STATUS, StatusPill, TABLE_ROW_CLASSES, TONES } from "@forwend/ui-web";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ConfirmingHint } from "@/features/invoices/components/invoice-progress";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentDetail } from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { dateTime } from "@/shared/lib/dates";

type PaymentOption = PaymentDetail["options"][number];

export interface WalletTransferRowProps {
  option: PaymentOption;
}

/** The paid amount's transfer to the merchant's wallet, as a row of the Transfers table beside the deposits. */
export function WalletTransferRow({ option }: WalletTransferRowProps) {
  const settlement = option.settlement;
  const settled = option.settlementStatus === "settled";
  if (!settlement && !settled) return null;
  const txHash = settled ? settlement?.txHash : (settlement?.receiptTxHash ?? settlement?.txHash);
  const amount = settled ? option.amounts.settled : option.amounts.payable;
  const state = settled ? (
    <StatusPill status={PAYMENT_STATUS.settled} />
  ) : settlement?.status === "refused" ? (
    <Badge tone={TONES.danger}>{COPY.transferReview}</Badge>
  ) : settlement?.wait === "unresolved" ? (
    <Badge tone={TONES.warning}>{COPY.transferUnresolved}</Badge>
  ) : settlement?.wait === "cap" ? (
    <Badge tone={TONES.warning}>{COPY.transferCap}</Badge>
  ) : settlement?.blocksLeft != null || settlement?.status === "sent" ? (
    <span className="inline-flex items-center gap-1">
      <StatusPill status={PAYMENT_STATUS.confirming} />
      <ConfirmingHint blocks={settlement.blocksLeft} seconds={settlement.secondsLeft} />
    </span>
  ) : settlement?.wait ? (
    <Badge tone={TONES.warning}>{COPY.transferDelayed}</Badge>
  ) : (
    <Badge tone={TONES.neutral}>{COPY.transferPreparing}</Badge>
  );
  return (
    <tr className={`${TABLE_ROW_CLASSES} [&>td]:py-2.5`}>
      <td>
        <TransferCell
          icon={ArrowUpRight}
          label={COPY.toWallet}
          time={settlement?.signedAt ? dateTime(settlement.signedAt) : null}
          state={<span role="status">{state}</span>}
        />
      </td>
      <td className="whitespace-nowrap max-2xl:hidden">
        <NetworkName chainId={option.chainId} />
      </td>
      <td role="status" className="max-sm:hidden">
        {state}
      </td>
      <td className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
        {BigInt(amount) > 0n ? (
          <PaymentAmount amount={amount} decimals={option.decimals} symbol={option.symbol} />
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="text-right">
        {txHash ? <ExplorerLink chainId={option.chainId} txHash={txHash} /> : null}
      </td>
    </tr>
  );
}

export interface TransferCellProps {
  icon: LucideIcon;
  label: string;
  time: string | null;
  /** On phones the state column is hidden, so the state shows here under the time. */
  state: ReactNode;
}

/** A transfer's first cell: what it is, when, and on phones its state. */
export function TransferCell({ icon: Icon, label, time, state }: TransferCellProps) {
  return (
    <span className="flex items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0 text-muted" />
      <span className="flex flex-col items-start gap-0.5">
        <span className="whitespace-nowrap text-ink">{label}</span>
        {time ? <span className="text-xs whitespace-nowrap text-muted">{time}</span> : null}
        <span className="mt-1 sm:hidden">{state}</span>
      </span>
    </span>
  );
}
