import { formatTokenAmount, PAYMENT_STATUS, TIMELINE_STATES } from "@forwend/ui-web";
import { optionFees } from "@/features/invoices/lib/invoices";
import { JOURNEY_KINDS, SUM_CELLS } from "@/features/payments/constants/payments";
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
import { exactDigits } from "@/shared/lib/money";

/** A deposit 1Click saw and converts or converted: one it returned, or a short one it holds, didn't pay the payment
 * (R-239). */
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

/** The NEAR Intents payment that pays this one (R-239). Money booked first on another option pays it instead, and a
 * deposit 1Click returned pays nothing: both read as a direct payment. */
export function crossChainOf(payment: PaymentDetail): CrossChainPayment | null {
  return paidThroughIntents(payment.crossChain) && crossChainOptionRecorded(payment)
    ? payment.crossChain
    : null;
}

/** The options with money, else the one the payment is recorded on. */
function usedOptions(payment: PaymentDetail): PaymentOption[] {
  const funded = payment.options.filter(
    (option) =>
      option.deposits.length > 0 || (payment.optionLocked && option.optionId === payment.optionId),
  );
  return funded.length
    ? funded
    : payment.options.filter((option) => option.optionId === payment.optionId);
}

/** R-248: the payment's money as one sum. What came in, each amount taken from it, and what the wallet gets. */
export function paymentMoney(payment: PaymentDetail): PaymentMoney {
  const chosen = payment.options.find((option) => option.optionId === payment.optionId);
  // A payment with money on other options lists those transfers below.
  const lead = leadOption(payment, payment.options, (option) => option.deposits.length > 0);
  const figures = lead
    ? optionFigures(
        lead.amount,
        (payment.receipts ?? []).find((receipt) => receipt.optionId === lead.optionId),
      )
    : null;
  const paidWith =
    lead ?? (chosen && (payment.optionLocked || payment.optionCount === 1) ? chosen : undefined);
  // R-228: the fees settlement pays from this option's amount, and what reaches the owner.
  const fees = paidWith ? optionFees(paidWith) : null;
  const paid = payment.paymentStatus === API_PAYMENT_STATUSES.paid;
  const canceled = payment.paymentStatus === API_PAYMENT_STATUSES.canceled;
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
    else if (
      figures.due > 0n &&
      figures.received > 0n &&
      !payment.closed &&
      paymentDisplayStatus(payment) !== PAYMENT_STATUS.canceled
    )
      cells.push(cell(SUM_CELLS.due, figures.due, lead));
  }
  // The owner receives nothing of a payment canceled or closed unpaid.
  const owed = !canceled && !(payment.closed && !paid);
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
  return { lead, paidWith, cells, adds, settled };
}

/** R-248: every movement of the payment's money in order, from the facts the API gave: never a step ahead of them. */
export function paymentJourney(payment: PaymentDetail, money: PaymentMoney): JourneyStep[] {
  const used = usedOptions(payment);
  const deposits = used
    .flatMap((option) => option.deposits.map((deposit) => ({ deposit, option })))
    .sort((x, y) => x.deposit.blockTime.localeCompare(y.deposit.blockTime));
  const paid = payment.paymentStatus === API_PAYMENT_STATUSES.paid;
  const ended =
    !paid && (payment.closed || payment.paymentStatus === API_PAYMENT_STATUSES.canceled);
  // The customer's own transfer and its conversion (R-239). They stay when money on another option paid the payment
  // first: the customer still sent it, and its USDC is held for them. A deposit 1Click returned moved nothing here.
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
    // Confirmed only once booked: a deposit final on chain but not yet booked still reads as confirming (D-24).
    state:
      deposit.late || (deposit.status !== API_DEPOSIT_STATUSES.detected && deposit.paid !== null)
        ? done
        : next,
  }));
  if (sent) {
    const converted = moved.findIndex(
      (step) => step.kind === JOURNEY_KINDS.deposit && step.converted,
    );
    // Before the USDC it became; until then, after every deposit already here.
    moved.splice(
      converted < 0 ? moved.length : converted,
      0,
      { id: JOURNEY_KINDS.origin, kind: JOURNEY_KINDS.origin, cross: sent, state: done },
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
  // 1Click delivered and the scan has not booked that deposit yet: the row carries its Base transaction.
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
  // Held money sent back to a payer (PLAN 11.10.3).
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

/** An amount as text, with every digit it has. */
export function crossMoney(units: bigint, of: { decimals: number; symbol: string }): string {
  return `${formatTokenAmount({ baseUnits: units, decimals: of.decimals, fractionDigits: exactDigits(units, of.decimals) })} ${of.symbol}`;
}
