"use client";
import { Button } from "@forwend/ui-web";
import { useGetPaymentMovementsInfiniteQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
export interface PaymentMovementsProps {
  profileId: string;
  paymentId: string;
}
export function PaymentMovements({ profileId, paymentId }: PaymentMovementsProps) {
  const list = useGetPaymentMovementsInfiniteQuery({ profileId, paymentId });
  const rows = list.currentData?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-labelledby="movements-title" className="fw-panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="movements-title" className="font-medium text-ink">
          Financial movements
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          Refresh movements
        </Button>
      </header>
      <div className="px-4 py-3 text-sm text-muted sm:px-5">
        <p>
          These pages are live. Observations can become bookings while you browse. Export CSV for
          one complete, consistent snapshot.
        </p>
        {list.isError ? (
          <p role="alert" className="mt-2 text-danger">
            We could not refresh movements. Try again.
          </p>
        ) : null}
      </div>
      {!list.currentData ? (
        <p role="status" className="px-4 pb-4 text-sm text-muted sm:px-5">
          {list.isError ? "Movements unavailable." : "Loading movements…"}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted sm:px-5">No movements recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">
                  {row.kind} · {row.state === "booked" ? "Booked" : "Observed, not booked"}
                </p>
                <time className="text-xs text-muted" dateTime={row.recordedAt}>
                  {new Date(row.recordedAt).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-muted">
                <NetworkName chainId={row.chainId} />
                {row.symbol ? ` · ${row.symbol}` : " · asset in base units"}
              </p>
              <p className="break-all font-mono text-xs text-muted">Token {row.token}</p>
              {row.receiverDelta !== null && row.decimals !== null && row.symbol ? (
                <p>
                  Receiver change{" "}
                  <PaymentAmount
                    amount={row.receiverDelta}
                    decimals={row.decimals}
                    symbol={row.symbol}
                  />
                </p>
              ) : (
                <p className="text-muted">
                  Source amount {row.sourceAmount ?? "unknown"} base units. Excluded from booked
                  totals.
                </p>
              )}
              {row.decimals !== null &&
              row.symbol &&
              row.payableDelta !== null &&
              row.payableDelta !== "0" ? (
                <p className="text-sm">
                  Merchant payable change{" "}
                  <PaymentAmount
                    amount={row.payableDelta}
                    decimals={row.decimals}
                    symbol={row.symbol}
                  />
                </p>
              ) : null}
              {row.decimals !== null &&
              row.symbol &&
              row.heldDelta !== null &&
              row.heldDelta !== "0" ? (
                <p className="text-sm">
                  Payer-held change{" "}
                  <PaymentAmount
                    amount={row.heldDelta}
                    decimals={row.decimals}
                    symbol={row.symbol}
                  />
                </p>
              ) : null}
              {row.receiverDelta === "0" ? (
                <p className="text-xs text-muted">
                  Allocation between merchant and payer balances. No token transfer.
                </p>
              ) : null}
              <p className="text-xs text-muted">
                {row.verified ? "Source certified" : "Source not certified"} · block{" "}
                {row.blockNumber ?? "unknown"} · event index {row.logIndex ?? "none"} · token
                transfer index {row.transferLogIndex ?? "none"}
              </p>
              {row.txHash ? (
                <p className="flex min-w-0 items-center gap-1">
                  <code className="truncate text-xs text-muted" title={row.txHash}>
                    {row.txHash}
                  </code>
                  <ExplorerLink chainId={row.chainId} txHash={row.txHash} />
                </p>
              ) : null}
              {row.reconciliationError ? (
                <p className="text-warning">
                  Source evidence is incomplete. Review before reconciling.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <div className="p-4 sm:p-5">
          <Button
            variant="secondary"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            Show more movements
          </Button>
        </div>
      ) : null}
    </section>
  );
}
