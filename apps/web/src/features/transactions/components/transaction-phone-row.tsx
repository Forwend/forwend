import {
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  ROW_INTERACTIVE_CLASSES,
  shortAddress,
} from "@forwend/ui-web";
import { ChevronDown, LoaderCircle, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { DirectionIcon } from "@/features/transactions/components/direction-icon";
import { SignedAmount } from "@/features/transactions/components/signed-amount";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { mintOrBurn, transactionStatus, typeName } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { hasChainBadge } from "@/shared/components/chains/chain-badge";
import { chainName } from "@/shared/lib/chains";
import { timeOfDay } from "@/shared/lib/dates";

/** The phone row's title: the invoice and client it paid, else the other side's address. */
function rowTitle(t: Transaction): ReactNode {
  const minted = mintOrBurn(t);
  if (minted) return minted;
  if (t.invoice && !t.labelable) return typeName(t);
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const lead =
    t.payment && !t.labelable
      ? TRANSACTIONS_COPY.paymentFrom
      : !incoming && t.classification === TRANSACTION_CLASSES.ownTransfer
        ? TRANSACTIONS_COPY.ownTransferTo
        : incoming
          ? TRANSACTIONS_COPY.from
          : TRANSACTIONS_COPY.to;
  return (
    <>
      {lead}{" "}
      <span className="font-mono font-normal text-muted">{shortAddress(t.counterparty)}</span>
    </>
  );
}

export interface TransactionPhoneRowProps {
  t: Transaction;
  /** The overview's preview names no type (R-109). */
  typed: boolean;
  onOpen: () => void;
}

/** Two lines a row: what it was and its amount, then its status and time. A tap opens the rest, the fee too. */
export function TransactionPhoneRow({ t, typed, onOpen }: TransactionPhoneRowProps) {
  const status = transactionStatus(t);
  const untyped =
    typed &&
    t.labelable &&
    (t.classification === TRANSACTION_CLASSES.unclassified ||
      t.classification === TRANSACTION_CLASSES.paymentException);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
    >
      <span className="mt-0.5">
        <DirectionIcon t={t} large />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-h-5.5 min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-ink">{rowTitle(t)}</span>
          <SignedAmount t={t} className="ml-auto shrink-0 font-semibold" />
        </span>
        <span className="flex min-h-5 min-w-0 items-center gap-1.5 truncate text-xs text-muted">
          {status === PAYMENT_STATUS.confirmed ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
          ) : (
            <LoaderCircle
              aria-hidden
              className="size-3 shrink-0 animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]"
            />
          )}
          <span className={status === PAYMENT_STATUS.confirmed ? "" : "font-medium text-ink"}>
            {PAYMENT_STATUSES[status].label}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={t.at} className="whitespace-nowrap">
            {timeOfDay(t.at)}
          </time>
          {hasChainBadge(t.chainId) ? (
            <span className="sr-only">, {chainName(t.chainId)}</span>
          ) : (
            <span>· {chainName(t.chainId)}</span>
          )}
        </span>
        {untyped ? (
          <span className="mt-1.5 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2.5 text-xs font-medium text-ink shadow-[inset_0_0_0_1px_var(--fw-line-strong)]">
            <Tag aria-hidden className="size-3.5" />
            {TRANSACTIONS_COPY.setType}
            <ChevronDown aria-hidden className="size-3.5 text-muted" />
          </span>
        ) : null}
      </span>
    </button>
  );
}
