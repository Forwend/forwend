import { shortAddress, TIMELINE_STATES, Timeline, type TimelineEntry } from "@forwend/ui-web";
import { ArrowRight } from "lucide-react";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  Figure,
  LiveLine,
  NothingMore,
  StepLine,
  TxLink,
  useLastSteps,
} from "@/features/pay/components/pay-progress";
import { OriginMark, PayTokenMark } from "@/features/pay/components/token-marks";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { amountText } from "@/features/pay/lib/pay";
import type { CrossChain } from "@/features/pay/types/crosschain";
import { PoweredByNearIntents } from "@/shared/components/chains/near-intents";
import { CROSS_CHAIN_STATUSES, CROSS_CHAIN_TARGET } from "@/shared/constants/chains";
import { ENTER } from "@/shared/constants/motion";
import { blockchainName, blockchainTxLink, chainName } from "@/shared/lib/chains";
import { timeNear, timeOfDay } from "@/shared/lib/dates";

const COPY = PAY_COPY.crossChain;

export interface CrossChainProgressProps {
  invoice: Invoice;
  crossChain: CrossChain;
  now: number;
  readAt: number | null;
  confirming: boolean;
  calm: boolean;
  stateLine: string;
  payee: string | undefined;
}

export function CrossChainProgress({
  invoice,
  crossChain,
  now,
  readAt,
  confirming,
  calm,
  stateLine,
  payee,
}: CrossChainProgressProps) {
  const chain = blockchainName(crossChain.blockchain);
  const base = chainName(CROSS_CHAIN_TARGET.chainId);
  const onBase = invoice.deposits.length > 0 || invoice.options.some((o) => o.deposits.length > 0);
  const converted = onBase || Boolean(crossChain.convertedAt);
  const sent = BigInt(crossChain.deposited ?? crossChain.amountIn);
  const refunded = BigInt(crossChain.refunded ?? "0");
  const origin = crossChain.originTxs[0];
  // Only 1Click's SUCCESS says the USDC left: an amount named while converting is still a plan.
  const success = crossChain.status === CROSS_CHAIN_STATUSES.success;
  const arrival = success ? crossChain.destinationTxs[0] : undefined;
  const held = crossChain.status === CROSS_CHAIN_STATUSES.incomplete;
  const today = new Date(now).toISOString();
  const time = (at: string | null) => (at ? timeNear(at, today) : null);
  const originMark = <OriginMark crossChain={crossChain} />;
  const targetMark = (
    <PayTokenMark chainId={CROSS_CHAIN_TARGET.chainId} symbol={CROSS_CHAIN_TARGET.symbol} />
  );
  const last = useLastSteps({
    invoice,
    network: base,
    payee,
    readAt,
    arrived: converted,
    counting: onBase && confirming,
    line: onBase ? stateLine : PAY_COPY.updatesItself,
  });
  const converting = held ? shortDepositLine(crossChain, now) : COPY.converting;
  const steps: TimelineEntry[] = [
    {
      id: "received",
      title: PAY_COPY.steps.received,
      state: TIMELINE_STATES.done,
      aside: origin ? (
        <TxLink hash={origin.hash} link={blockchainTxLink(crossChain.blockchain, origin)} />
      ) : undefined,
      description: (
        <Figure
          mark={originMark}
          amount={amountText(sent, crossChain)}
          rest={
            crossChain.depositSeenAt
              ? PAY_COPY.receivedOn(chain, timeNear(crossChain.depositSeenAt, today))
              : PAY_COPY.on(chain)
          }
        />
      ),
    },
    {
      id: "converting",
      title: converted
        ? COPY.steps.converted(CROSS_CHAIN_TARGET.symbol)
        : COPY.steps.converting(CROSS_CHAIN_TARGET.symbol),
      state: converted ? TIMELINE_STATES.done : TIMELINE_STATES.current,
      working: !held,
      aside: arrival ? (
        <TxLink hash={arrival.hash} chainId={CROSS_CHAIN_TARGET.chainId} />
      ) : undefined,
      description: (
        <div className="flex flex-col gap-1.5">
          {converted ? (
            success && crossChain.delivered ? (
              <Figure
                mark={targetMark}
                amount={amountText(BigInt(crossChain.delivered), CROSS_CHAIN_TARGET)}
                rest={COPY.arrived(base, time(crossChain.convertedAt))}
              />
            ) : null
          ) : (
            <>
              {held ? null : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5 text-xs">
                  {originMark}
                  {COPY.onChain(crossChain.symbol, chain)}
                  <ArrowRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
                  {targetMark}
                  {COPY.onChain(CROSS_CHAIN_TARGET.symbol, base)}
                </span>
              )}
              <StepLine>{converting}</StepLine>
            </>
          )}
          {/* 1Click names no refund transaction. */}
          {refunded > 0n ? (
            <span className="text-xs">
              {COPY.returnedTo(amountText(refunded, crossChain), shortAddress(crossChain.refundTo))}
            </span>
          ) : null}
        </div>
      ),
    },
    ...last.steps,
  ];
  return (
    <section
      aria-labelledby="pay-cross-progress"
      className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}
    >
      <h2 id="pay-cross-progress" className="sr-only">
        {PAY_COPY.progress}
      </h2>
      {/* A short deposit pays nothing: the payer still owes the invoice. */}
      {calm && !held ? <NothingMore /> : null}
      <LiveLine>{last.line ?? converting}</LiveLine>
      <Timeline label={PAY_COPY.progress} entries={steps} />
      <PoweredByNearIntents />
    </section>
  );
}

function shortDepositLine(c: CrossChain, now: number): string {
  return now < Date.parse(c.deadline)
    ? COPY.incomplete(timeOfDay(c.deadline))
    : COPY.incompleteLate;
}

export function CrossChainEnded({ crossChain }: { crossChain: CrossChain }) {
  const line = crossChain.status === CROSS_CHAIN_STATUSES.refunded ? COPY.refunded : COPY.failed;
  return (
    <div
      role="status"
      className="flex flex-col gap-1 border-b border-line px-4 py-3 text-sm sm:px-5"
    >
      <span className="text-ink">{line}</span>
      <span className="text-xs text-muted">{COPY.supportId(crossChain.quoteId)}</span>
    </div>
  );
}
