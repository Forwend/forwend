import { PAYMENT_STATUS, TIMELINE_STATES } from "@forwend/ui-web";
import { optionFees } from "@/features/invoices/lib/invoices";
import {
  JOURNEY_KINDS,
  SETTLEMENT_STATES,
  SUM_CELLS,
} from "@/features/payments/constants/payments";
import { leadOption, optionFigures, paymentDisplayStatus } from "@/features/payments/lib/payments";
import type {
  CrossChainPayment,
  JourneyStep,
  PaymentDetail,
  PaymentMoney,
  PaymentOption,
  SumCell,
} from "@/features/payments/types/payments";
import { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/shared/constants/payment-state";
import { crossChainEnded, crossChainOptionRecorded } from "@/shared/lib/chains";

/** A deposit 1Click saw and converts or converted; one returned or held short paid nothing. */
export function paidThroughIntents(
  c: PaymentDetail["crossChain"] | undefined,
): c is CrossChainPayment {
  return (
    c != null &&
    c.depositSeenAt !== null &&
    !crossChainEnded(c) &&
    c.status !== CROSS_CHAIN_STATUSES.incomplete
  );
}

/** The NEAR Intents payment that pays this one, unless money on another option paid it first. */
export function crossChainOf(payment: PaymentDetail): CrossChainPayment | null {
  return paidThroughIntents(payment.crossChain) && crossChainOptionRecorded(payment)
    ? payment.crossChain
    : null;
}

const OVER: readonly string[] = [
  PAYMENT_STATUS.canceled,
  PAYMENT_STATUS.expired,
  PAYMENT_STATUS.expiredPartiallyPaid,
];

/** The API's status can say expired before its closed flag does. */
export function checkoutOver(payment: PaymentDetail): boolean {
  return payment.closed || OVER.includes(paymentDisplayStatus(payment));
}

function usedOptions(payment: PaymentDetail): PaymentOption[] {
  const funded = payment.options.filter(
    (option) =>
      option.deposits.length > 0 || (payment.optionLocked && option.optionId === payment.optionId),
  );
  return funded.length
    ? funded
    : payment.options.filter((option) => option.optionId === payment.optionId);
}

export function paymentMoney(payment: PaymentDetail): PaymentMoney {
  const chosen = payment.options.find((option) => option.optionId === payment.optionId);
  const lead = leadOption(payment, payment.options, (option) => option.deposits.length > 0);
  const figures = lead
    ? optionFigures(
        lead.amount,
        (payment.receipts ?? []).find((receipt) => receipt.optionId === lead.optionId),
      )
    : null;
  const paidWith =
    lead ?? (chosen && (payment.optionLocked || payment.optionCount === 1) ? chosen : undefined);
  const fees = paidWith ? optionFees(paidWith) : null;
  const paid = payment.paymentStatus === API_PAYMENT_STATUSES.paid;
  const canceled = payment.paymentStatus === API_PAYMENT_STATUSES.canceled;
  const over = checkoutOver(payment);
  const settled = paidWith?.settlementStatus === API_SETTLEMENT_STATUSES.settled;
  const cell = (
    id: SumCell["id"],
    units: bigint,
    of: { decimals: number; symbol: string },
  ): SumCell => ({ id, units, decimals: of.decimals, symbol: of.symbol });
  const cells: SumCell[] = [];
  if (lead && figures && figures.received > 0n)
    cells.push(cell(SUM_CELLS.paid, figures.received, lead));
  else if (paidWith) cells.push(cell(SUM_CELLS.requested, BigInt(paidWith.amount), paidWith));
  else
    cells.push(
      cell(SUM_CELLS.requested, BigInt(payment.amount), {
        decimals: payment.decimals,
        symbol: payment.optionCount > 1 ? MONEY_COPY.usd : payment.symbol,
      }),
    );
  if (lead && figures) {
    const refunded = BigInt(lead.amounts.refunded);
    if (refunded > 0n) cells.push(cell(SUM_CELLS.returned, refunded, lead));
    if (figures.extra > 0n) cells.push(cell(SUM_CELLS.held, figures.extra, lead));
    else if (figures.due > 0n && figures.received > 0n && !over)
      cells.push(cell(SUM_CELLS.due, figures.due, lead));
  }
  // The owner receives nothing of a payment canceled or closed unpaid.
  const owed = !canceled && !(over && !paid);
  if (paidWith && fees && owed) {
    if (fees.network > 0n) cells.push(cell(SUM_CELLS.networkFee, fees.network, paidWith));
    if (fees.platform > 0n) cells.push(cell(SUM_CELLS.platformFee, fees.platform, paidWith));
    if (fees.total > 0n || paid || settled)
      cells.push(
        cell(SUM_CELLS.wallet, settled ? BigInt(paidWith.amounts.settled) : fees.net, paidWith),
      );
  }
  const first = cells[0];
  const end = cells.at(-1);
  const taken = cells.slice(1, -1);
  const adds =
    first !== undefined &&
    end?.id === SUM_CELLS.wallet &&
    taken.every((c) => c.id !== SUM_CELLS.due) &&
    first.symbol === end.symbol &&
    first.decimals === end.decimals &&
    first.units - taken.reduce((sum, c) => sum + c.units, 0n) === end.units;
  // The API's paid, never a guess from the figures: money held for the payer counts toward nothing.
  const moving =
    paid &&
    !settled &&
    end?.id === SUM_CELLS.wallet &&
    paidWith?.settlement?.status !== SETTLEMENT_STATES.refused &&
    !paidWith?.settlement?.wait;
  return { lead, paidWith, cells, adds, settled, moving };
}

export function paymentJourney(payment: PaymentDetail, money: PaymentMoney): JourneyStep[] {
  const used = usedOptions(payment);
  const deposits = used
    .flatMap((option) => option.deposits.map((deposit) => ({ deposit, option })))
    .sort((x, y) => x.deposit.blockTime.localeCompare(y.deposit.blockTime));
  const paid = payment.paymentStatus === API_PAYMENT_STATUSES.paid;
  const ended = !paid && checkoutOver(payment);
  // They stay when another option paid first: the customer still sent it, and its USDC is held.
  const sent = paidThroughIntents(payment.crossChain) ? payment.crossChain : null;
  // The USDC 1Click delivered on Base: never an earlier direct deposit.
  const baseTx =
    sent?.status === CROSS_CHAIN_STATUSES.success ? sent.destinationTxs[0]?.hash : undefined;
  const paidBy = deposits
    .filter(({ deposit }) => deposit.paid !== null && BigInt(deposit.paid) > 0n)
    .at(-1)?.deposit;
  const done = TIMELINE_STATES.done;
  const next = TIMELINE_STATES.upcoming;
  const moved: JourneyStep[] = deposits.map(({ deposit, option }) => ({
    id: `${deposit.txHash}:${deposit.logIndex}`,
    kind: JOURNEY_KINDS.deposit,
    deposit,
    option,
    converted: baseTx !== undefined && baseTx.toLowerCase() === deposit.txHash.toLowerCase(),
    paid: paid && deposit === paidBy,
    // Confirmed only once booked: final on chain but unbooked still reads as confirming.
    state:
      deposit.late || (deposit.status !== API_DEPOSIT_STATUSES.detected && deposit.paid !== null)
        ? done
        : next,
  }));
  if (sent) {
    const converted = moved.findIndex(
      (step) => step.kind === JOURNEY_KINDS.deposit && step.converted,
    );
    moved.splice(
      converted < 0 ? moved.length : converted,
      0,
      { id: JOURNEY_KINDS.origin, kind: JOURNEY_KINDS.origin, cross: sent, state: done },
      ...(sent.refunded && BigInt(sent.refunded) > 0n
        ? [{ id: JOURNEY_KINDS.surplus, kind: JOURNEY_KINDS.surplus, cross: sent, state: done }]
        : []),
      {
        id: JOURNEY_KINDS.converting,
        kind: JOURNEY_KINDS.converting,
        cross: sent,
        state:
          sent.status === CROSS_CHAIN_STATUSES.success || (paid && crossChainOf(payment) !== null)
            ? done
            : next,
      },
    );
  }
  const steps: JourneyStep[] = [
    { id: JOURNEY_KINDS.created, kind: JOURNEY_KINDS.created, state: done },
    ...moved,
  ];
  const unbooked =
    baseTx !== undefined &&
    !moved.some((step) => step.kind === JOURNEY_KINDS.deposit && step.converted);
  if (unbooked || (!deposits.length && !ended && !paid))
    steps.push({
      id: JOURNEY_KINDS.awaiting,
      kind: JOURNEY_KINDS.awaiting,
      cross: sent,
      state: next,
    });
  for (const cell of money.cells)
    if (cell.id === SUM_CELLS.networkFee || cell.id === SUM_CELLS.platformFee)
      steps.push({
        id: cell.id,
        kind: JOURNEY_KINDS.fee,
        cell,
        state: money.settled ? done : next,
      });
  const transfers = used.filter(
    (option) => option.settlement || option.settlementStatus === API_SETTLEMENT_STATUSES.settled,
  );
  for (const option of transfers)
    steps.push({
      id: `wallet:${option.optionId}`,
      kind: JOURNEY_KINDS.wallet,
      option,
      state: option.settlementStatus === API_SETTLEMENT_STATUSES.settled ? done : next,
    });
  if (ended) steps.push({ id: JOURNEY_KINDS.closed, kind: JOURNEY_KINDS.closed, state: done });
  else if (!transfers.length)
    steps.push({ id: JOURNEY_KINDS.wallet, kind: JOURNEY_KINDS.wallet, state: next });
  const returns = payment.options
    .flatMap((option) => option.returns.map((sent) => ({ option, sent })))
    .sort((a, b) => a.sent.blockTime.localeCompare(b.sent.blockTime));
  for (const { option, sent } of returns)
    steps.push({
      id: `${option.optionId}:${sent.txHash}:${sent.to}:${sent.amount}`,
      kind: JOURNEY_KINDS.returned,
      option,
      sent,
      state: done,
    });
  // A fee is a note on the transfer after it, never the step in progress.
  const current = ended
    ? -1
    : steps.findIndex((step) => step.state !== done && step.kind !== JOURNEY_KINDS.fee);
  return steps.map((step, i) =>
    i === current ? { ...step, state: TIMELINE_STATES.current } : step,
  );
}
