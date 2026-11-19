import { Money, StatusPill, TABLE_HEAD_CLASSES, TABLE_ROW_CLASSES } from "@forwend/ui-web";
import { Counterparty } from "@/features/transactions/components/counterparty";
import { DirectionIcon } from "@/features/transactions/components/direction-icon";
import { RecordsValue } from "@/features/transactions/components/records-value";
import { SignedAmount } from "@/features/transactions/components/signed-amount";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import { TRANSACTION_DIRECTIONS } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import {
  mintOrBurn,
  transactionFee,
  transactionKey,
  transactionStatus,
} from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { hasChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { chainName } from "@/shared/lib/chains";
import { dayTime } from "@/shared/lib/dates";
import { exactDigits } from "@/shared/lib/money";

export interface TransactionsDesktopTableProps {
  profileId: string;
  title: string;
  /** The overview's preview names no type (R-109). */
  preview: boolean;
  rows: Transaction[];
}

export function TransactionsDesktopTable({
  profileId,
  title,
  preview,
  rows,
}: TransactionsDesktopTableProps) {
  return (
    <table className="hidden w-full text-sm @3xl:table">
      <caption className="sr-only">{title}</caption>
      <TransactionsTableHead preview={preview} />
      <tbody className="divide-y divide-line">
        {rows.map((t) => (
          <tr
            key={transactionKey(t)}
            className={`transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]`}
          >
            <td className="max-w-0">
              <Party t={t} />
            </td>
            {preview ? null : (
              // A compact select keeps the row on one line; touch keeps the full-size target.
              <td className="whitespace-nowrap pointer-fine:[&_[role=combobox]]:h-8">
                <TransactionType profileId={profileId} t={t} />
              </td>
            )}
            <td className="hidden whitespace-nowrap text-muted @5xl:table-cell">
              <NetworkName chainId={t.chainId} />
            </td>
            <td className="whitespace-nowrap text-muted tabular-nums">
              <span className="inline-flex items-center gap-1">
                <time dateTime={t.at}>{dayTime(t.at)}</time>
                <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
              </span>
            </td>
            <td className="whitespace-nowrap">
              <StatusPill quiet status={transactionStatus(t)} />
            </td>
            <td className="text-right whitespace-nowrap">
              <Fee t={t} />
            </td>
            <td className="text-right">
              <span className="inline-flex flex-col items-end">
                <SignedAmount t={t} />
                {t.recordsValue ? <RecordsValue value={t.recordsValue} /> : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shared with the loading form, so the real headers stay while rows load. */
export function TransactionsTableHead({ preview }: { preview: boolean }) {
  const c = TRANSACTIONS_COPY.columns;
  return (
    <thead>
      <tr className={TABLE_HEAD_CLASSES}>
        <th scope="col" className="w-1/3">
          {c.transaction}
        </th>
        {preview ? null : <th scope="col">{c.type}</th>}
        <th scope="col" className="hidden @5xl:table-cell">
          {c.network}
        </th>
        <th scope="col">{c.date}</th>
        <th scope="col">{c.status}</th>
        <th scope="col" className="text-right">
          {c.fee}
        </th>
        <th scope="col" className="text-right">
          {c.amount}
        </th>
      </tr>
    </thead>
  );
}

// The network is a column or, without room, the logo on the icon.
function Party({ t }: { t: Transaction }) {
  const minted = mintOrBurn(t);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <DirectionIcon t={t} badgeClassName="@5xl:hidden" />
      <span className="block min-w-0 truncate font-medium text-ink">
        {minted ?? (
          <>
            {t.direction === TRANSACTION_DIRECTIONS.in
              ? TRANSACTIONS_COPY.from
              : TRANSACTIONS_COPY.to}{" "}
            <Counterparty t={t} />
          </>
        )}
        {hasChainBadge(t.chainId) ? (
          <span className="sr-only @5xl:hidden">, {chainName(t.chainId)}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Never part of the amount: taken before money arrived, or paid on top of money sent. A dash where none was recorded. */
function Fee({ t }: { t: Transaction }) {
  const fee = transactionFee(t);
  if (fee === null)
    return (
      <span className="text-subtle">
        <span aria-hidden>—</span>
        <span className="sr-only">{TRANSACTIONS_COPY.noFeeRecorded}</span>
      </span>
    );
  if (fee === 0n) return <span className="text-muted">{TRANSACTIONS_COPY.noFee}</span>;
  return (
    <Money
      baseUnits={fee}
      decimals={t.decimals}
      token={t.symbol}
      fractionDigits={exactDigits(fee, t.decimals)}
      nowrap
      className="text-ink"
    />
  );
}
