import { Money, shortAddress, Tooltip } from "@forwend/ui-web";
import type { ReactNode } from "react";
import { exactDigits, type Invoice, type InvoiceToken } from "@/features/invoices/invoices";
import { INVOICE_COPY, INVOICES_COPY } from "@/features/invoices/invoices-copy";
import { ExplorerLink } from "@/shared/chains/explorer-link";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The settle transaction that moved the money to the creator's wallet. */
export interface SettlementRow {
  txHash: string;
  to: string;
  amount: bigint;
  at: string | null;
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
}: {
  invoice: Pick<Invoice, "chainId" | "token" | "deposits">;
  token: Pick<InvoiceToken, "symbol" | "decimals"> | null;
  title?: string;
  settlement?: SettlementRow | null;
}) {
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
    <div className="flex flex-col gap-2">
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
      <span className="flex flex-col">
        <span className="text-xs text-muted">{kind}</span>
        {amount}
      </span>
      {note ? <span className="text-xs text-warning">{note}</span> : null}
      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {side}
          <Tooltip content={address}>
            <button
              type="button"
              aria-label={address}
              className="rounded-sm font-mono outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
            >
              {shortAddress(address)}
            </button>
          </Tooltip>
          {at ? (
            <>
              <span aria-hidden>·</span>
              <time dateTime={at}>{TIME.format(Date.parse(at))}</time>
            </>
          ) : null}
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-xs text-muted" title={txHash}>
            {shortAddress(txHash)}
          </span>
          <ExplorerLink chainId={chainId} txHash={txHash} named />
        </span>
      </span>
    </li>
  );
}
