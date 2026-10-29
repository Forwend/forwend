"use client";

import {
  Badge,
  Button,
  DateRangePicker,
  DetailList,
  DetailRow,
  EmptyState,
  SearchField,
  Skeleton,
  TONES,
} from "@forwend/ui-web";
import { Scale } from "lucide-react";
import { useState } from "react";
import { useGetPaymentReconciliationQuery } from "@/features/payments/api/payments-api";
import { Disclosure } from "@/features/payments/components/disclosure";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { RECONCILIATION_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type {
  PaymentFilters,
  PaymentReconciliation as Report,
} from "@/features/payments/types/payments";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { TOKEN_SEARCH_FROM, tokenMatches } from "@/shared/lib/chains";
import { foldText } from "@/shared/lib/search";

type Asset = Report["assets"][number];

const ACCOUNTS = ["receiver", "payable", "held"] as const;
const COLUMNS = ["opening", "changes", "closing"] as const;
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
// A profile can hold hundreds of tokens across stores: groups come 20 at a time.
const PAGE = 20;

// No money in any account and none moved in the range: the usual state of a token that is on but unused.
const isQuiet = (a: Asset) =>
  COLUMNS.every((c) => ACCOUNTS.every((k) => a[c][k] === "0")) &&
  a.settled === "0" &&
  a.refunded === "0";

export interface PaymentReconciliationProps {
  profileId: string;
  filters: PaymentFilters;
}

// A balance summary, as Stripe's: one table, a group per token and store, three accounts each. The proof that the
// books match the chain waits in a closed panel; the badge says whether it holds.
export function PaymentReconciliation({ profileId, filters }: PaymentReconciliationProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const report = useGetPaymentReconciliationQuery({
    profileId,
    filters,
    from: from || undefined,
    to: to || undefined,
  });
  const data = report.currentData;
  const [query, setQuery] = useState("");
  const [showQuiet, setShowQuiet] = useState(false);
  const [count, setCount] = useState(PAGE);
  const assets = data?.assets ?? [];
  const found = assets.filter(
    (a) => tokenMatches(a, query) || foldText(a.storeName ?? "").includes(foldText(query.trim())),
  );
  const listed = query || showQuiet ? found : found.filter((a) => !isQuiet(a));
  const quiet = found.length - listed.length;
  const shown = listed.slice(0, count);
  // Only what the table lists: a token with nothing in it has nothing to verify.
  const states = listed.map(health);
  const tally = [COPY.verified, COPY.checking, COPY.review]
    .map((label) => ({ label, n: states.filter((s) => s.label === label).length }))
    .filter((t) => t.n > 0);
  return (
    <section aria-labelledby="reconciliation-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reconciliation-title" className="text-base font-semibold text-ink">
            {COPY.title}
          </h2>
          <p className="text-sm text-muted">
            {COPY.intro}
            {data ? ` ${COPY.asOf(TIME.format(new Date(data.snapshotAt)))}.` : null}
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <DateRangePicker
            label={COPY.period}
            value={{ from: from || null, to: to || null }}
            note={COPY.periodNote}
            clearLabel={COPY.clearPeriod}
            onChange={(range) => {
              setFrom(range.from ?? "");
              setTo(range.to ?? "");
            }}
          />
        </div>
      </div>
      {assets.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {assets.length > TOKEN_SEARCH_FROM ? (
            <SearchField
              label={COPY.search}
              placeholder={COPY.searchPlaceholder}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setCount(PAGE);
              }}
              className="sm:max-w-sm"
            />
          ) : (
            <span />
          )}
          <p className="text-sm text-muted">
            {tally.map((t) => `${t.n} ${t.label.toLowerCase()}`).join(" · ")}
          </p>
        </div>
      ) : null}
      <div className="fw-panel flex min-h-72 flex-col overflow-hidden">
        {report.isError && !data ? (
          <LoadError message={COPY.failed} onRetry={() => void report.refetch()} />
        ) : !data ? (
          <div aria-hidden className="flex flex-col gap-3 p-4 sm:p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState compact icon={Scale} title={COPY.none} />
        ) : shown.length === 0 ? (
          query ? (
            <NoMatch compact onClear={() => setQuery("")} clearLabel={COPY.clearSearch} />
          ) : (
            <EmptyState compact icon={Scale} title={COPY.allQuiet} />
          )
        ) : (
          <table className="w-full text-sm sm:table-fixed">
            <thead className="max-sm:sr-only">
              <tr className="border-b border-line text-left text-xs font-medium text-muted">
                <th scope="col" className="h-10 px-4 font-medium sm:w-[34%] sm:px-5">
                  {COPY.columns.account}
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={`h-10 px-4 text-right font-medium sm:px-5 ${c === "closing" ? "" : "max-sm:hidden"}`}
                  >
                    {COPY.columns[c]}
                  </th>
                ))}
              </tr>
            </thead>
            {shown.map((asset) => (
              <AssetRows key={`${asset.storeId}:${asset.chainId}:${asset.token}`} asset={asset} />
            ))}
          </table>
        )}
        {listed.length > shown.length || quiet > 0 ? (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
            {listed.length > shown.length ? (
              <Button size="sm" variant="secondary" onClick={() => setCount((n) => n + PAGE)}>
                {COPY.more(Math.min(PAGE, listed.length - shown.length))}
              </Button>
            ) : null}
            {quiet > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setShowQuiet(true)}>
                {COPY.showQuiet(quiet)}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {shown.length > 0 ? (
        <Disclosure title={COPY.details}>
          <div className="flex flex-col gap-4">
            {shown.map((asset) => (
              <Proof key={`${asset.storeId}:${asset.chainId}:${asset.token}`} asset={asset} />
            ))}
          </div>
        </Disclosure>
      ) : null}
    </section>
  );
}

function health(asset: Asset): { label: string; tone: (typeof TONES)[keyof typeof TONES] } {
  if (asset.policyExceptions > 0 || asset.otherAssetMovements > 0)
    return { label: COPY.review, tone: TONES.warning };
  const settled =
    asset.verifiedReceivers === asset.receiverCount &&
    asset.unreconciledReceivers === 0 &&
    asset.pendingDeposits === 0 &&
    asset.unbookedDeposits === 0 &&
    asset.unbookedOutflows === 0;
  return settled
    ? { label: COPY.verified, tone: TONES.success }
    : { label: COPY.checking, tone: TONES.neutral };
}

function AssetRows({ asset }: { asset: Asset }) {
  const state = health(asset);
  return (
    <tbody className="border-b border-line last:border-b-0">
      <tr className="bg-surface-2">
        <th scope="colgroup" colSpan={4} className="px-4 py-2.5 text-left font-normal sm:px-5">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <TokenMark chainId={asset.chainId} symbol={asset.symbol} />
              <span className="text-muted">{asset.storeName ?? COPY.profilePayments}</span>
              {asset.livemode ? null : <Badge tone={TONES.neutral}>{COPY.testMode}</Badge>}
            </span>
            <Badge tone={state.tone}>{state.label}</Badge>
          </span>
        </th>
      </tr>
      {ACCOUNTS.map((account) => (
        <tr key={account} className="border-t border-line">
          <th scope="row" className="h-11 px-4 text-left font-normal text-ink sm:px-5">
            {COPY.accounts[account]}
          </th>
          {COLUMNS.map((c) => (
            <td
              key={c}
              className={`px-4 text-right whitespace-nowrap sm:px-5 ${c === "closing" ? "font-medium text-ink" : "text-muted max-sm:hidden"}`}
            >
              <PaymentAmount amount={asset[c][account]} {...asset} />
            </td>
          ))}
        </tr>
      ))}
      <tr className="border-t border-line">
        <td colSpan={4} className="px-4 py-2.5 text-xs text-muted sm:px-5">
          {COPY.moved} <PaymentAmount amount={asset.settled} {...asset} /> · {COPY.returned}{" "}
          <PaymentAmount amount={asset.refunded} {...asset} />
        </td>
      </tr>
    </tbody>
  );
}

function Proof({ asset }: { asset: Asset }) {
  const block = (n: number | null) => (n === null ? COPY.unknown : String(n));
  return (
    <div className="flex flex-col gap-2">
      <TokenMark chainId={asset.chainId} symbol={asset.symbol} />
      <p className="text-sm text-muted">
        {COPY.addresses(asset.verifiedReceivers, asset.receiverCount)}.{" "}
        {COPY.blocks(
          block(asset.minVerifiedBlock),
          block(asset.maxVerifiedBlock),
          block(asset.chainFinalizedBlock),
        )}
        .
      </p>
      <DetailList>
        <DetailRow term={COPY.unverified}>{asset.unreconciledReceivers}</DetailRow>
        <DetailRow term={COPY.pending}>{asset.pendingDeposits}</DetailRow>
        <DetailRow term={COPY.unbookedIn}>{asset.unbookedDeposits}</DetailRow>
        <DetailRow term={COPY.unbookedOut}>{asset.unbookedOutflows}</DetailRow>
        <DetailRow term={COPY.otherAssets}>{asset.otherAssetMovements}</DetailRow>
        <DetailRow term={COPY.exceptions}>{asset.policyExceptions}</DetailRow>
        <DetailRow term={COPY.difference}>
          {asset.checkpointDifference === null ? (
            COPY.noDifference
          ) : (
            <PaymentAmount amount={asset.checkpointDifference} {...asset} />
          )}
        </DetailRow>
      </DetailList>
    </div>
  );
}
