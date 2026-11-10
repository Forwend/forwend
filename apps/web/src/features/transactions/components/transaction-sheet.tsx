"use client";

import { DetailList, DetailRow, Money, Sheet, StatusPill, shortAddress } from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { Counterparty } from "@/features/transactions/components/counterparty";
import { RecordsValue } from "@/features/transactions/components/records-value";
import { SignedAmount } from "@/features/transactions/components/signed-amount";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import {
  transactionFee,
  transactionKey,
  transactionStatus,
} from "@/features/transactions/lib/transactions";
import type { Transaction, TransactionClass } from "@/features/transactions/types/transactions";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface TransactionSheetProps {
  profileId: string;
  /** Kept while the sheet closes, so it doesn't empty first. */
  t: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A phone row opened: the amount, the sum its fee belongs to, the addresses and links, and the type. */
export function TransactionSheet({ profileId, t, open, onOpenChange }: TransactionSheetProps) {
  const incoming = t?.direction === TRANSACTION_DIRECTIONS.in;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={incoming ? COPY.received : COPY.sent}>
      {/* Keyed per transfer: a type chosen for one never shows on the next. */}
      {t ? <SheetBody key={transactionKey(t)} profileId={profileId} t={t} /> : null}
    </Sheet>
  );
}

function typeName(t: Transaction): string {
  if (t.invoice && !t.labelable)
    return COPY.invoicePaid(invoiceNumber(t.invoice.number), t.invoice.clientName);
  if (t.payment && !t.labelable) return COPY.classes[TRANSACTION_CLASSES.payment];
  return COPY.classes[t.classification as TransactionClass] ?? t.classification;
}

function SheetBody({ profileId, t }: { profileId: string; t: Transaction }) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const fee = transactionFee(t);
  const amount = BigInt(t.amount);
  // Each line of the sum to its last digit, so the three figures add up as shown.
  const exact = (units: bigint) => (
    <Money
      baseUnits={units}
      decimals={t.decimals}
      token={t.symbol}
      fractionDigits={exactDigits(units, t.decimals)}
      nowrap
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SignedAmount t={t} className="text-amount" />
        <p className="mt-1 text-sm text-muted">
          {typeName(t)} · {chainName(t.chainId)}
        </p>
      </div>
      {fee ? (
        <dl className="flex flex-col gap-1.5 rounded-md bg-surface-2 px-3.5 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">{incoming ? COPY.customerPaid : COPY.sentAmount}</dt>
            <dd>{exact(incoming ? amount + fee : amount)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">{incoming ? COPY.columns.fee : COPY.networkFee}</dt>
            <dd className="whitespace-nowrap">
              {incoming ? "− " : "+ "}
              {exact(fee)}
            </dd>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-line-strong pt-2 font-medium">
            <dt>{incoming ? COPY.arrived : COPY.leftWallet}</dt>
            <dd>{exact(incoming ? amount : amount + fee)}</dd>
          </div>
        </dl>
      ) : null}
      <DetailList className="-mx-5 border-y border-line sm:mx-0 sm:rounded-md sm:border">
        <DetailRow term={COPY.columns.status}>
          <StatusPill quiet status={transactionStatus(t)} />
        </DetailRow>
        <DetailRow term={COPY.columns.date}>
          <time dateTime={t.at}>{WHEN.format(new Date(t.at))}</time>
        </DetailRow>
        <DetailRow term={incoming ? COPY.from : COPY.to}>
          <Counterparty t={t} />
        </DetailRow>
        <DetailRow term={COPY.transaction}>
          <span className="inline-flex items-center gap-1 font-mono text-muted">
            {shortAddress(t.txHash)}
            <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
          </span>
        </DetailRow>
        {t.recordsValue ? (
          <DetailRow term={t.recordsValue.currency}>
            <RecordsValue value={t.recordsValue} />
          </DetailRow>
        ) : null}
        <DetailRow term={COPY.columns.type}>
          <TransactionType profileId={profileId} t={t} />
        </DetailRow>
      </DetailList>
    </div>
  );
}
