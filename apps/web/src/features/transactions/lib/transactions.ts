import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import type { Send } from "@/features/send/types/send";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { Transaction, TransactionClass } from "@/features/transactions/types/transactions";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/** A transfer is "Confirming" until its block is final; unknown values never claim it is final. */
export function transactionStatus(t: Transaction): PaymentStatus {
  return t.status === TRANSACTION_STATUSES.confirmed
    ? PAYMENT_STATUS.confirmed
    : t.status === TRANSACTION_STATUSES.sending
      ? PAYMENT_STATUS.sending
      : PAYMENT_STATUS.confirming;
}

/** R-224: the gas the wallet paid for the send behind an outgoing transfer; R-228: for a settlement, what it paid out
 * of the payment before the rest reached the wallet. In the token's base units; null where none was recorded. */
export function transactionFee(t: Transaction): bigint | null {
  const fee = t.feePaid ?? t.payment?.fees;
  return fee == null ? null : BigInt(fee);
}

/** Minted or Burned for a transfer from or to the zero address; null for any other. */
export function mintOrBurn(t: Transaction): string | null {
  if (t.counterparty.toLowerCase() !== ZERO_ADDRESS) return null;
  return t.direction === TRANSACTION_DIRECTIONS.in
    ? TRANSACTIONS_COPY.minted
    : TRANSACTIONS_COPY.burned;
}

/** What the transfer was: the invoice or payment it paid, else its class. */
export function typeName(t: Transaction): string {
  if (t.invoice && !t.labelable)
    return TRANSACTIONS_COPY.invoicePaid(invoiceNumber(t.invoice.number), t.invoice.clientName);
  if (t.payment && !t.labelable) return TRANSACTIONS_COPY.classes[TRANSACTION_CLASSES.payment];
  return TRANSACTIONS_COPY.classes[t.classification as TransactionClass] ?? t.classification;
}

/** A signed send no block holds yet, as a row (R-215). Its transfer's own row takes its place once recorded; it has
 * no log yet, so its key's log index is -1, and no USD value, since no row shows one. */
function sendingRow(s: Send & { txHash: string }): Transaction {
  return {
    chainId: s.chainId,
    token: s.token,
    symbol: s.symbol,
    decimals: s.decimals,
    direction: TRANSACTION_DIRECTIONS.out,
    amount: s.amount,
    counterparty: s.to,
    txHash: s.txHash,
    logIndex: -1,
    blockNumber: 0,
    at: s.createdAt,
    status: TRANSACTION_STATUSES.sending,
    usdValue: "0",
    classification: s.toProfileId ? TRANSACTION_CLASSES.ownTransfer : TRANSACTION_CLASSES.sent,
    labelable: false,
    invoice: null,
    recordsValue: null,
    feePaid: null,
  };
}

/** The pending sends still owed a row: signed, and no recorded row carries their hash yet (R-215). */
export function sendingRows(sends: Send[], recorded: Transaction[]): Transaction[] {
  return sends
    .filter((s): s is Send & { txHash: string } => s.txHash !== null)
    .filter((s) => !recorded.some((t) => t.txHash === s.txHash))
    .map(sendingRow);
}

interface DayGroup<T> {
  /** The local calendar day, YYYY-MM-DD. */
  day: string;
  /** Its first item's time, which names the day. */
  at: string;
  items: T[];
}

const localDay = (time: Date) =>
  `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")}`;

/** Keeps the items' order: runs of the same local day, not sorted. */
export function groupByDay<T extends { at: string }>(items: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = localDay(new Date(item.at));
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, at: item.at, items: [item] });
  }
  return groups;
}

/** One key per transfer: a transaction can move tokens several times, once per log. */
export function transactionKey(t: Transaction): string {
  return `${t.chainId}:${t.txHash}:${t.logIndex}`;
}
