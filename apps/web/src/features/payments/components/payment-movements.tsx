"use client";
import { Button, TABLE_HEAD_CLASSES, TABLE_ROW_CLASSES } from "@forwend/ui-web";
import { Fragment, useState } from "react";
import { useGetPaymentMovementsInfiniteQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";

export interface PaymentMovementsProps {
  profileId: string;
  paymentId: string;
}

export function PaymentMovements({ profileId, paymentId }: PaymentMovementsProps) {
  const list = useGetPaymentMovementsInfiniteQuery({ profileId, paymentId });
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = list.currentData?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="Payment transactions" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          Refresh transactions
        </Button>
      </div>
      {list.isError ? (
        <p role="alert" className="text-sm text-danger">
          Transactions could not be refreshed. Try again.
        </p>
      ) : null}
      {!list.currentData ? (
        <p className="text-sm text-muted">
          {list.isError ? "Transactions unavailable." : "Loading transactions…"}
        </p>
      ) : !rows.length ? (
        <p className="text-sm text-muted">No transactions yet.</p>
      ) : (
        <table className="w-full table-fixed text-left text-sm lg:table-auto">
          <thead>
            <tr className={TABLE_HEAD_CLASSES}>
              <th scope="col">Event</th>
              <th scope="col" className="text-right">
                Amount
              </th>
              <th scope="col" className="hidden sm:table-cell">
                Status
              </th>
              <th scope="col" className="hidden lg:table-cell">
                Date
              </th>
              <th scope="col">
                <span className="sr-only">Transaction and details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const transfer = ["deposit", "refund", "settlement", "recovery"].includes(row.kind);
              const missing =
                transfer &&
                row.state === "booked" &&
                (!row.verified || Boolean(row.reconciliationError));
              const complete =
                row.verified &&
                (row.kind === "recovery"
                  ? !row.reconciliationError || row.reconciliationError === "different_asset"
                  : row.state === "booked" && !row.reconciliationError);
              const label =
                row.kind === "deposit"
                  ? "Customer payment"
                  : row.kind === "settlement"
                    ? "Transfer to wallet"
                    : row.kind === "refund"
                      ? "Refund"
                      : row.kind === "recovery"
                        ? "Funds returned"
                        : row.kind === "expiry"
                          ? "Checkout expired"
                          : row.kind === "reopen"
                            ? "Checkout reopened"
                            : "Balance adjustment";
              const status = !transfer ? "Recorded" : complete ? "Confirmed" : "Confirming";
              return (
                <Fragment key={row.id}>
                  <tr className={TABLE_ROW_CLASSES}>
                    <td className="py-3 pr-2">
                      <span className="font-medium text-ink">{label}</span>
                      <span className="block text-xs text-muted sm:hidden">{status}</span>
                      <span className="block text-xs text-muted">{chainName(row.chainId)}</span>
                      <time
                        dateTime={row.recordedAt}
                        className="block text-xs text-muted lg:hidden"
                      >
                        {new Date(row.recordedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                      {missing ? (
                        <span className="block text-xs text-warning">
                          Transfer records incomplete. Contact support.
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {transfer &&
                      row.decimals !== null &&
                      row.symbol &&
                      row.sourceAmount !== null ? (
                        <PaymentAmount
                          amount={row.sourceAmount}
                          decimals={row.decimals}
                          symbol={row.symbol}
                          className="flex-wrap justify-end break-all"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="hidden px-2 py-3 text-muted sm:table-cell">{status}</td>
                    <td className="hidden px-2 py-3 text-muted lg:table-cell">
                      <time dateTime={row.recordedAt}>
                        {new Date(row.recordedAt).toLocaleString()}
                      </time>
                    </td>
                    <td className="py-3 pl-2">
                      <div className="flex items-center justify-end gap-2">
                        {row.txHash ? (
                          <ExplorerLink chainId={row.chainId} txHash={row.txHash} />
                        ) : null}
                        <Button
                          variant="link"
                          size="sm"
                          aria-expanded={expanded === row.id}
                          aria-controls={`movement-${row.id}`}
                          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        >
                          Details
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.id ? (
                    <tr id={`movement-${row.id}`}>
                      <td colSpan={3} className="py-3">
                        <div className="flex flex-col gap-2 text-xs text-muted">
                          <p className="break-all">Token {row.token}</p>
                          {row.sourceAmount !== null ? (
                            <p className="break-all">Amount: {row.sourceAmount} base units</p>
                          ) : null}
                          <p>
                            Block {row.blockNumber ?? "—"} · Log {row.logIndex ?? "—"}
                          </p>
                          <p>
                            {!transfer
                              ? "Internal balance change; no token transfer."
                              : row.verified
                                ? "Transfer evidence verified."
                                : "Transfer evidence is still being checked."}
                          </p>
                          {row.decimals !== null && row.symbol ? (
                            <dl>
                              {(
                                [
                                  { label: "Merchant balance change", value: row.payableDelta },
                                  { label: "Customer balance change", value: row.heldDelta },
                                ] as const
                              )
                                .filter((change) => change.value !== null && change.value !== "0")
                                .map((change) => (
                                  <div key={change.label}>
                                    <dt>{change.label}</dt>
                                    <dd>
                                      <PaymentAmount
                                        amount={change.value ?? "0"}
                                        decimals={row.decimals ?? 0}
                                        symbol={row.symbol ?? ""}
                                      />
                                    </dd>
                                  </div>
                                ))}
                            </dl>
                          ) : null}
                          {row.reconciliationError ? (
                            <p className="break-words">Check: {row.reconciliationError}</p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          Show more transactions
        </Button>
      ) : null}
    </section>
  );
}
