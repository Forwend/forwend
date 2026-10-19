import { Money, shortAddress, TruncatedAddress } from "@forwend/ui-web";
import type { ReactNode } from "react";
import { INVOICE_COPY, INVOICES_COPY } from "@/features/invoices/constants/invoices-copy";
import type { Invoice, InvoiceToken } from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { exactDigits } from "@/shared/lib/money";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The settle transaction that moved the money to the creator's wallet. */
export interface SettlementRow {
  txHash: string;
  to: string;
  amount: bigint;
  at: string | null;
}

export interface InvoiceDepositsProps {
  invoice: Pick<Invoice, "chainId" | "token" | "deposits">;
  token: Pick<InvoiceToken, "symbol" | "decimals"> | null;
  title?: string;
  settlement?: SettlementRow | null;
}

/**
 * Every transaction of the invoice in one list (R-69): each payment the chain shows for it, then the settlement to the
 * wallet once there is one; refunds join later (PLAN 9.4). Each row: what it was, amount, the other side, time,
 * transaction and a link to it on the block explorer.
 */
export function InvoiceDeposits({
  invoice,
  token,
  title = INVOICE_COPY.deposits,
  settlement,
}: InvoiceDepositsProps) {
  if (invoice.deposits.length === 0 && !settlement) return null;
  const amountOf = (units: bigint, raw: string) =>
    token ? (
      <Money
        baseUnits={units}
        decimals={token.decimals}
        fractionDigits={exactDigits(units, token.decimals)}
        token={token.symbol}
        className="text-ink"
      />
    ) : (
      <span className="text-ink">
        <span className="font-mono tabular-nums">{raw}</span>{" "}
        <span className="text-muted">{INVOICES_COPY.baseUnits(shortAddress(invoice.token))}</span>
      </span>
    );
  return (
    <div className="@container flex flex-col gap-2">
      <h3 className="text-xs text-muted">{title}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {invoice.deposits.map((d) => (
          <Transaction
            key={`${d.txHash}:${d.logIndex}`}
            kind={INVOICE_COPY.payment}
            amount={amountOf(BigInt(d.amount), d.amount)}
            note={d.late ? INVOICE_COPY.late : null}
            side={INVOICE_COPY.from}
            address={d.from}
            at={d.blockTime}
            chainId={invoice.chainId}
            txHash={d.txHash}
          />
        ))}
        {settlement ? (
          <Transaction
            kind={INVOICE_COPY.settlement}
            amount={amountOf(settlement.amount, settlement.amount.toString())}
            note={null}
            side={INVOICE_COPY.to}
            address={settlement.to}
            at={settlement.at}
            chainId={invoice.chainId}
            txHash={settlement.txHash}
          />
        ) : null}
      </ul>
    </div>
  );
}

function Transaction({
  kind,
  amount,
  note,
  side,
  address,
  at,
  chainId,
  txHash,
}: {
  kind: string;
  amount: ReactNode;
  note: string | null;
  side: string;
  address: string;
  at: string | null;
  chainId: number;
  txHash: string;
}) {
  return (
    // A narrow list (a phone, or the column beside Details): what it was and when on one line, who and the transaction
    // under it. A wide one: all four in one row. The list's width decides, not the screen's.
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm [grid-template-areas:'what_when''who_tx'] @2xl:grid-cols-[minmax(0,1fr)_auto_auto_auto] @2xl:[grid-template-areas:'what_who_when_tx']">
      <span className="flex flex-col [grid-area:what]">
        <span className="text-xs text-muted">
          {kind}
          {note ? <span className="text-warning"> · {note}</span> : null}
        </span>
        {amount}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted [grid-area:who]">
        {side}
        <TruncatedAddress address={address} />
      </span>
      {at ? (
        <time
          dateTime={at}
          className="justify-self-end self-start text-xs text-muted [grid-area:when] @2xl:self-center"
        >
          {TIME.format(Date.parse(at))}
        </time>
      ) : null}
      <span className="flex items-center justify-self-end gap-1 [grid-area:tx]">
        <span className="font-mono text-xs text-muted" title={txHash}>
          {shortAddress(txHash)}
        </span>
        <ExplorerLink chainId={chainId} txHash={txHash} named />
      </span>
    </li>
  );
}
