"use client";
import { Button, TextField } from "@forwend/ui-web";
import { useState } from "react";
import { useGetPaymentReconciliationQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { NetworkName } from "@/shared/components/chains/network-name";
export interface PaymentReconciliationProps {
  profileId: string;
  filters: PaymentFilters;
}
export function PaymentReconciliation({ profileId, filters }: PaymentReconciliationProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalid = Boolean(from && to && from > to);
  const report = useGetPaymentReconciliationQuery(
    { profileId, filters, from: from || undefined, to: to || undefined },
    { skip: invalid },
  );
  return (
    <section aria-labelledby="reconciliation-title" className="flex flex-col gap-4">
      <div>
        <h2 id="reconciliation-title" className="text-lg font-semibold text-ink">
          Balance report
        </h2>
        <p className="text-sm text-muted">
          Opening balances plus recorded movements equal closing balances. Each token and store
          stays separate.
        </p>
      </div>
      <div className="grid max-w-lg gap-4 sm:grid-cols-2">
        <TextField
          label="From recorded day (UTC)"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To recorded day (UTC)"
          type="date"
          value={to}
          min={from || undefined}
          error={invalid ? "Choose a day on or after From." : undefined}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {invalid ? null : report.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          We could not load the balance report.
          <Button variant="secondary" size="sm" onClick={() => void report.refetch()}>
            Try again
          </Button>
        </div>
      ) : !report.currentData ? (
        <p role="status" className="text-sm text-muted">
          Loading balance report…
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Snapshot {new Date(report.currentData.snapshotAt).toLocaleString()}. Receiver
            checkpoints may use different finalized blocks. Historical balances are not compared
            with current checkpoints.
          </p>
          {report.currentData.assets.length === 0 ? (
            <p className="text-sm text-muted">No matching payment records.</p>
          ) : (
            report.currentData.assets.map((asset) => (
              <article
                key={`${asset.storeId}:${asset.chainId}:${asset.token}`}
                className="fw-panel overflow-hidden"
              >
                <header className="border-b border-line px-4 py-3 sm:px-5">
                  <h3 className="font-medium text-ink">
                    {asset.storeName ?? "Profile payments"} · {asset.symbol} ·{" "}
                    <NetworkName chainId={asset.chainId} />
                    {asset.livemode ? null : " · Test mode"}
                  </h3>
                  <p className="break-all font-mono text-xs text-muted">{asset.token}</p>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th scope="col" className="px-4 py-3">
                          Account
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Opening
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Changes
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Closing
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {(
                        [
                          { key: "receiver", label: "In receive contracts" },
                          { key: "payable", label: "Owed to merchant" },
                          { key: "held", label: "Held for payers" },
                        ] as const
                      ).map((row) => (
                        <tr key={row.key}>
                          <th scope="row" className="px-4 py-3 text-left font-normal text-ink">
                            {row.label}
                          </th>
                          {(["opening", "changes", "closing"] as const).map((column) => (
                            <td key={column} className="px-4 py-3 text-right">
                              <PaymentAmount amount={asset[column][row.key]} {...asset} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
                  <p>
                    Settled in this period: <PaymentAmount amount={asset.settled} {...asset} />.
                    Returned: <PaymentAmount amount={asset.refunded} {...asset} />.
                  </p>
                  <p>
                    {asset.verifiedReceivers} of {asset.receiverCount} receivers have complete
                    history. Verified blocks {asset.minVerifiedBlock ?? "unknown"}–
                    {asset.maxVerifiedBlock ?? "unknown"}; latest finalized block{" "}
                    {asset.chainFinalizedBlock ?? "unknown"}.
                  </p>
                  <p>
                    Unreconciled receivers: {asset.unreconciledReceivers}. Pending deposits:{" "}
                    {asset.pendingDeposits}. Unbooked deposits: {asset.unbookedDeposits}. Unbooked
                    outflows: {asset.unbookedOutflows}. Other-asset movements:{" "}
                    {asset.otherAssetMovements}. Policy exceptions: {asset.policyExceptions}.
                  </p>
                  <p>
                    Comparable checkpoint difference:{" "}
                    {asset.checkpointDifference === null ? (
                      "Unavailable for this period or source coverage"
                    ) : (
                      <PaymentAmount amount={asset.checkpointDifference} {...asset} />
                    )}
                    .
                  </p>
                </div>
              </article>
            ))
          )}
        </>
      )}
    </section>
  );
}
