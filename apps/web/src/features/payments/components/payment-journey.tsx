import {
  Badge,
  BrandIcon,
  cx,
  PAYMENT_STATUS,
  StatusPill,
  shortAddress,
  TIMELINE_STATES,
  TONES,
} from "@forwend/ui-web";
import { Minus, Repeat, Undo2, Wallet } from "lucide-react";
import { type ReactNode, useId } from "react";
import { ConfirmingHint, ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { optionFees } from "@/features/invoices/lib/invoices";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { JOURNEY_KINDS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import { crossMoney } from "@/features/payments/lib/payment-journey";
import type {
  JourneyStep,
  PaymentDeposit,
  PaymentDetail,
  PaymentOption,
} from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import {
  BLOCKCHAIN_ICONS,
  CHAINS,
  CROSS_CHAIN_STATUSES,
  CROSS_CHAIN_TARGET,
  CROSS_CHAIN_TOKEN_ICONS,
  TOKEN_ICONS,
} from "@/shared/constants/chains";
import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/shared/constants/payment-state";
import { blockchainName, blockchainTxLink, chainName, iconOf } from "@/shared/lib/chains";
import { dateTime } from "@/shared/lib/dates";

export interface PaymentJourneyProps {
  payment: PaymentDetail;
  steps: readonly JourneyStep[];
}

/** R-248: How the money moved. One row per movement: what it is, where and when, its amount and its transaction. */
export function PaymentJourney({ payment, steps }: PaymentJourneyProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="fw-panel overflow-hidden">
      <h2 id={id} className="fw-panel-head text-base font-semibold text-ink">
        {COPY.journey.title}
      </h2>
      <ol className="flex flex-col px-4 py-1.5 sm:px-5">
        {steps.map((step) => {
          const row = rowOf(step, payment);
          const upcoming = step.state === TIMELINE_STATES.upcoming;
          return (
            <li
              key={step.id}
              aria-current={step.state === TIMELINE_STATES.current ? "step" : undefined}
              className={cx(
                "relative grid grid-cols-[2.25rem_minmax(0,1fr)_1.75rem] items-center gap-x-3 before:absolute before:top-0 before:bottom-0 before:left-[1.125rem] before:w-px before:bg-line-strong first:before:top-1/2 last:before:bottom-1/2 sm:grid-cols-[2.25rem_minmax(0,1fr)_8.5rem] sm:gap-x-4",
                row.quiet ? "py-2" : "py-3.5",
              )}
            >
              <span className="relative z-10 grid size-9 place-items-center">{row.node}</span>
              {/* The amount sits beside the text while both fit; a long one moves under it and may break. */}
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <span className="flex min-w-36 flex-1 flex-col items-start gap-0.5">
                  <span
                    className={cx(
                      "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm",
                      row.quiet ? "text-muted" : upcoming ? "text-subtle" : "font-medium text-ink",
                    )}
                  >
                    {row.title}
                    {row.quiet && row.sub ? (
                      <span className="text-xs text-subtle">{row.sub}</span>
                    ) : null}
                  </span>
                  {!row.quiet && row.sub ? (
                    <span className="text-xs text-subtle">{row.sub}</span>
                  ) : null}
                  {row.status}
                </span>
                <span
                  className={cx(
                    "max-w-full text-right break-words tabular-nums [&_[data-money]]:justify-end",
                    row.quiet ? "text-sm text-muted" : "text-base font-medium",
                    upcoming ? "text-subtle" : row.quiet ? "" : "text-ink",
                  )}
                >
                  {row.amount}
                </span>
              </span>
              <span className="justify-self-end">{row.tx}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface Row {
  node: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** A state that still changes: confirming, preparing, delayed. */
  status?: ReactNode;
  amount?: ReactNode;
  tx?: ReactNode;
  /** A note between two movements: smaller, in muted text. */
  quiet?: boolean;
}

// Each node covers the line behind it with a ring of the panel's color.
const DOT = "block size-2.5 rounded-pill ring-4 ring-surface";
const DISC = "grid place-items-center rounded-pill ring-4 ring-surface";
const NOTE = `${DISC} size-6 border border-line-strong bg-surface text-muted [&_svg]:size-3`;

function rowOf(step: JourneyStep, payment: PaymentDetail): Row {
  const upcoming = step.state === TIMELINE_STATES.upcoming;
  switch (step.kind) {
    case JOURNEY_KINDS.created:
      return {
        quiet: true,
        node: <span className={`${DOT} bg-ink`} />,
        title: COPY.journey.created,
        sub: dateTime(payment.createdAt),
      };
    case JOURNEY_KINDS.closed:
      return {
        quiet: true,
        node: <span className={`${DOT} bg-ink`} />,
        title: COPY.closed,
        sub: dateTime(payment.closesAt),
      };
    case JOURNEY_KINDS.awaiting: {
      // 1Click delivered and the scan has not booked it yet: its Base transaction is already known.
      const delivered =
        step.cross?.status === CROSS_CHAIN_STATUSES.success
          ? step.cross.destinationTxs[0]?.hash
          : undefined;
      return {
        node: <span className={`${DOT} border border-line-strong bg-surface`} />,
        title: step.cross ? COPY.journey.awaitingBase : COPY.journey.awaiting,
        tx: delivered ? <TxLink hash={delivered} chainId={CROSS_CHAIN_TARGET.chainId} /> : null,
      };
    }
    case JOURNEY_KINDS.origin: {
      const c = step.cross;
      const tx = c.originTxs[0];
      const refunded = c.refunded ? BigInt(c.refunded) : 0n;
      return {
        node: (
          <span className="rounded-pill bg-surface ring-4 ring-surface">
            <MarkIcon
              token={iconOf(CROSS_CHAIN_TOKEN_ICONS, c.symbol)}
              chain={iconOf(BLOCKCHAIN_ICONS, c.blockchain)}
              letter={c.symbol.slice(0, 1)}
            />
          </span>
        ),
        title: COPY.journey.sent,
        sub: (
          <>
            {COPY.journey.on(
              blockchainName(c.blockchain),
              c.depositSeenAt ? dateTime(c.depositSeenAt) : null,
            )}
            {refunded > 0n ? (
              <span className="block">{COPY.crossChain.refunded(crossMoney(refunded, c))}</span>
            ) : null}
          </>
        ),
        amount: (
          <PaymentAmount
            amount={c.deposited ?? c.amountIn}
            decimals={c.decimals}
            symbol={c.symbol}
          />
        ),
        tx: tx ? <TxLink hash={tx.hash} link={blockchainTxLink(c.blockchain, tx)} /> : null,
      };
    }
    case JOURNEY_KINDS.converting:
      return {
        quiet: true,
        node: (
          <span className={NOTE}>
            <Repeat aria-hidden />
          </span>
        ),
        title: (
          <>
            {step.state === TIMELINE_STATES.done
              ? COPY.journey.convertedBy
              : COPY.journey.converting}
            <NearIntents />
          </>
        ),
        sub: step.cross.convertedAt ? dateTime(step.cross.convertedAt) : undefined,
      };
    case JOURNEY_KINDS.deposit: {
      const { deposit, option } = step;
      return {
        node: <OptionMark option={option} />,
        title: (
          <>
            {step.converted ? COPY.journey.converted(option.symbol) : COPY.journey.sent}
            {step.paid ? <StatusPill status={PAYMENT_STATUS.paid} /> : null}
          </>
        ),
        sub: COPY.journey.on(chainName(option.chainId), dateTime(deposit.blockTime)),
        status: <DepositState deposit={deposit} />,
        amount: (
          <PaymentAmount
            amount={deposit.amount}
            decimals={option.decimals}
            symbol={option.symbol}
          />
        ),
        tx: <TxLink hash={deposit.txHash} chainId={option.chainId} />,
      };
    }
    case JOURNEY_KINDS.fee:
      return {
        quiet: true,
        node: (
          <span className={NOTE}>
            <Minus aria-hidden />
          </span>
        ),
        title: COPY.sum.cells[step.cell.id],
        amount: (
          <>
            −{" "}
            <PaymentAmount
              amount={step.cell.units.toString()}
              decimals={step.cell.decimals}
              symbol={step.cell.symbol}
            />
          </>
        ),
      };
    case JOURNEY_KINDS.wallet: {
      const option = step.option;
      const node = (
        <span
          className={cx(
            DISC,
            "size-9 [&_svg]:size-[var(--fw-icon-sm)]",
            upcoming || !option
              ? "border border-line-strong bg-surface text-subtle"
              : "bg-primary text-on-primary",
          )}
        >
          <Wallet aria-hidden />
        </span>
      );
      if (!option)
        return {
          node,
          title: COPY.toWallet,
          sub:
            payment.paymentStatus === API_PAYMENT_STATUSES.paid
              ? undefined
              : COPY.journey.afterPaid,
        };
      const settlement = option.settlement;
      const settled = option.settlementStatus === API_SETTLEMENT_STATUSES.settled;
      const txHash = settled
        ? settlement?.txHash
        : (settlement?.receiptTxHash ?? settlement?.txHash);
      // Settlement pays the option's fees out of what is owed; the wallet gets the rest (R-228).
      const owed = BigInt(option.amounts.payable) - optionFees(option).total;
      const amount = settled ? BigInt(option.amounts.settled) : owed;
      return {
        node,
        title: settled ? COPY.sum.cells.wallet : COPY.toWallet,
        sub: COPY.journey.on(
          chainName(option.chainId),
          settlement?.signedAt ? dateTime(settlement.signedAt) : null,
        ),
        status: settled ? null : (
          <span role="status" className="mt-1 inline-flex items-center gap-1">
            <TransferState settlement={settlement} />
          </span>
        ),
        amount:
          amount > 0n ? (
            <PaymentAmount
              amount={amount.toString()}
              decimals={option.decimals}
              symbol={option.symbol}
            />
          ) : null,
        tx: txHash ? <TxLink hash={txHash} chainId={option.chainId} /> : null,
      };
    }
    case JOURNEY_KINDS.returned:
      return {
        node: (
          <span
            className={`${DISC} size-9 border border-line bg-surface-2 text-ink [&_svg]:size-[var(--fw-icon-sm)]`}
          >
            <Undo2 aria-hidden />
          </span>
        ),
        title: COPY.returned,
        sub: COPY.journey.on(chainName(step.option.chainId), dateTime(step.sent.blockTime)),
        amount: (
          <>
            −{" "}
            <PaymentAmount
              amount={step.sent.amount}
              decimals={step.option.decimals}
              symbol={step.option.symbol}
            />
          </>
        ),
        tx: <TxLink hash={step.sent.txHash} chainId={step.option.chainId} />,
      };
  }
}

/** NEAR Intents by name: NEAR's mark, then the words. */
function NearIntents() {
  return (
    <span className="inline-flex items-center gap-[0.4em] font-medium whitespace-nowrap text-ink">
      <BrandIcon name="near" className="size-[1em]" />
      NEAR Intents
    </span>
  );
}

function OptionMark({ option }: { option: PaymentOption }) {
  return (
    <span className="rounded-pill bg-surface ring-4 ring-surface">
      <MarkIcon
        token={TOKEN_ICONS[option.symbol]}
        chain={CHAINS[option.chainId]?.icon}
        letter={option.symbol.slice(0, 1)}
      />
    </span>
  );
}

/** The transaction on its explorer: the short hash where the row has room, the icon alone on a phone. */
function TxLink({
  hash,
  ...where
}: { hash: string } & ({ chainId: number } | { link: { name: string; href: string } | null })) {
  return (
    <ExplorerLink txHash={hash} {...where}>
      <span className="font-mono text-xs max-sm:hidden">{shortAddress(hash)}</span>
    </ExplorerLink>
  );
}

// A booked deposit needs no state: its row says it happened.
function DepositState({ deposit }: { deposit: PaymentDeposit }) {
  if (deposit.late)
    return (
      <span className="mt-1">
        <Badge tone={TONES.neutral}>{COPY.late}</Badge>
      </span>
    );
  if (deposit.status === API_DEPOSIT_STATUSES.detected)
    return (
      <span className="mt-1">
        <ConfirmingStatus
          blocks={deposit.blocksLeft}
          total={deposit.blocksTotal}
          seconds={deposit.secondsLeft}
        />
      </span>
    );
  if (deposit.paid === null)
    return (
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <StatusPill status={PAYMENT_STATUS.confirming} />
        {COPY.depositVerifying}
      </span>
    );
  return null;
}

function TransferState({ settlement }: { settlement: PaymentOption["settlement"] }) {
  if (settlement?.status === "refused")
    return <Badge tone={TONES.danger}>{COPY.transferReview}</Badge>;
  if (settlement?.wait === "unresolved")
    return <Badge tone={TONES.warning}>{COPY.transferUnresolved}</Badge>;
  if (settlement?.wait === "cap") return <Badge tone={TONES.warning}>{COPY.transferCap}</Badge>;
  if (settlement?.blocksLeft != null || settlement?.status === "sent")
    return (
      <>
        <StatusPill status={PAYMENT_STATUS.confirming} />
        <ConfirmingHint blocks={settlement.blocksLeft} seconds={settlement.secondsLeft} />
      </>
    );
  if (settlement?.wait) return <Badge tone={TONES.warning}>{COPY.transferDelayed}</Badge>;
  return <Badge tone={TONES.neutral}>{COPY.transferPreparing}</Badge>;
}
