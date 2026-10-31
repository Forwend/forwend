import { Badge, TABLE_ROW_CLASSES, TONES } from "@forwend/ui-web";
import { Undo2 } from "lucide-react";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { TransferCell } from "@/features/payments/components/wallet-transfer-row";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentDetail } from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { dateTime } from "@/shared/lib/dates";

type PaymentOption = PaymentDetail["options"][number];

export interface ReturnRowProps {
  option: PaymentOption;
  sent: PaymentOption["returns"][number];
}

/** Held money sent back to a payer (PLAN 11.10.3), as a row of the Transfers table. */
export function ReturnRow({ option, sent }: ReturnRowProps) {
  const state = <Badge tone={TONES.neutral}>{COPY.returnedState}</Badge>;
  return (
    <tr className={`${TABLE_ROW_CLASSES} [&>td]:py-2.5`}>
      <td>
        <TransferCell
          icon={Undo2}
          label={COPY.returned}
          time={dateTime(sent.blockTime)}
          state={state}
        />
      </td>
      <td className="whitespace-nowrap max-2xl:hidden">
        <NetworkName chainId={option.chainId} />
      </td>
      <td className="max-sm:hidden">{state}</td>
      <td className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
        <PaymentAmount amount={sent.amount} decimals={option.decimals} symbol={option.symbol} />
      </td>
      <td className="text-right">
        <ExplorerLink chainId={option.chainId} txHash={sent.txHash} />
      </td>
    </tr>
  );
}
