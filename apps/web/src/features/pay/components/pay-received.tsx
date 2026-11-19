import { TIMELINE_STATES, Timeline, type TimelineEntry } from "@forwend/ui-web";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type { Invoice } from "@/features/invoices/types/invoices";
import { Overpaid } from "@/features/pay/components/held-note";
import {
  Figure,
  LiveLine,
  NothingMore,
  TxLink,
  useLastSteps,
} from "@/features/pay/components/pay-progress";
import { PayTokenMark } from "@/features/pay/components/token-marks";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { amountText, payeeName, seenInFull, stateLine } from "@/features/pay/lib/pay";
import type { PayStatus, PayToken } from "@/features/pay/types/pay";
import { ENTER } from "@/shared/constants/motion";
import { timeNear } from "@/shared/lib/dates";

export interface PayReceivedProps {
  invoice: Invoice;
  linkToken: string;
  pay: PayStatus;
  token: PayToken;
  network: string;
  now: number;
  readAt: number | null;
  lead: boolean;
}

export function PayReceived({
  invoice,
  linkToken,
  pay,
  token,
  network,
  now,
  readAt,
  lead,
}: PayReceivedProps) {
  const today = new Date(now).toISOString();
  const deposits = invoice.deposits.filter((d) => !d.late);
  const money = (units: bigint) => amountText(units, token);
  const last = useLastSteps({
    invoice,
    network,
    payee: payeeName(invoice),
    readAt,
    arrived: true,
    counting: pay.state === PAY_STATES.confirming,
    partial: pay.state === PAY_STATES.partial,
    line: stateLine(invoice, pay, token),
  });
  const steps: TimelineEntry[] = [
    ...deposits.map((d, i) => ({
      id: `${d.txHash}:${d.logIndex}`,
      title: i === 0 ? COPY.steps.received : COPY.steps.receivedMore,
      state: TIMELINE_STATES.done,
      aside: <TxLink hash={d.txHash} chainId={invoice.chainId} />,
      description: (
        <Figure
          mark={<PayTokenMark chainId={invoice.chainId} symbol={token.symbol} />}
          amount={money(BigInt(d.amount))}
          rest={
            <time dateTime={d.blockTime}>
              {COPY.receivedOn(network, timeNear(d.blockTime, today))}
            </time>
          }
        />
      ),
    })),
    ...last.steps,
  ];
  return (
    <section
      aria-labelledby="pay-progress"
      className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER} ${lead ? "" : "border-t border-line"}`}
    >
      <h2 id="pay-progress" className="sr-only">
        {COPY.progress}
      </h2>
      {/* Only once the whole amount came on time: a part payment may still owe the rest. */}
      {lead && seenInFull(invoice) ? <NothingMore /> : null}
      {last.line ? <LiveLine>{last.line}</LiveLine> : null}
      {invoice.depositSummary && invoice.depositSummary.count > invoice.deposits.length ? (
        <p className="text-xs text-muted">{INVOICE_COPY.depositPreview}</p>
      ) : null}
      <Timeline label={COPY.progress} entries={steps} />
      <Overpaid invoice={invoice} token={token} />
      {pay.state === PAY_STATES.partial ? (
        <CheckStatus
          payToken={linkToken}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
        />
      ) : null}
    </section>
  );
}
