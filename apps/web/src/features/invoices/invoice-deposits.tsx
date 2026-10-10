import { Money, StatusPill, shortAddress } from "@forwend/ui-web";
import { ACTIVITY_KINDS, activityStatus } from "@/features/activity/activity";
import { exactDigits, type Invoice } from "@/features/invoices/invoices";
import { INVOICE_COPY, INVOICES_COPY } from "@/features/invoices/invoices-copy";
import { ExplorerLink } from "@/shared/chains/explorer-link";

/**
 * Each payment the chain shows for the invoice: amount, status, transaction and a link to it on the block explorer.
 * The API gives no sender or time for a deposit; the explorer shows both.
 */
export function InvoiceDeposits({
  invoice,
  token,
}: {
  invoice: Invoice;
  token: { symbol: string; decimals: number } | null;
}) {
  if (invoice.deposits.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-muted">{INVOICE_COPY.deposits}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {invoice.deposits.map((d) => {
          const amount = BigInt(d.amount);
          return (
            <li
              key={`${d.txHash}:${d.logIndex}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm"
            >
              {token ? (
                <Money
                  baseUnits={amount}
                  decimals={token.decimals}
                  fractionDigits={exactDigits(amount, token.decimals)}
                  token={token.symbol}
                  className="text-ink"
                />
              ) : (
                <span className="text-ink">
                  <span className="font-mono tabular-nums">{d.amount}</span>{" "}
                  <span className="text-muted">
                    {INVOICES_COPY.baseUnits(shortAddress(invoice.token))}
                  </span>
                </span>
              )}
              <StatusPill
                status={activityStatus({ kind: ACTIVITY_KINDS.deposit, status: d.status })}
              />
              {d.late ? <span className="text-xs text-warning">{INVOICE_COPY.late}</span> : null}
              <span className="ml-auto flex items-center gap-1">
                <span className="font-mono text-xs text-muted" title={d.txHash}>
                  {shortAddress(d.txHash)}
                </span>
                <ExplorerLink chainId={invoice.chainId} txHash={d.txHash} named />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
