"use client";

import {
  Badge,
  Button,
  DateRangePicker,
  DetailList,
  DetailRow,
  EmptyState,
  IconButton,
  SearchField,
  SegmentedControl,
  Skeleton,
  TABLE_HEAD_CLASSES,
  TONES,
} from "@forwend/ui-web";
import { ChevronDown, Scale } from "lucide-react";
import { useId, useState } from "react";
import { useGetPaymentReconciliationQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { RECONCILIATION_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type {
  PaymentFilters,
  PaymentReconciliation as Report,
} from "@/features/payments/types/payments";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { tokenMatches } from "@/shared/lib/chains";
import { foldText } from "@/shared/lib/search";

type Asset = Report["assets"][number];

const ACCOUNTS = ["receiver", "payable", "held"] as const;
const COLUMNS = ["opening", "changes", "closing"] as const;
// A profile can hold hundreds of tokens across stores: groups come 20 at a time.
const PAGE = 20;
const ALL = "all";

// No money in any account and none moved in the range: the usual state of a token that is on but unused.
const isQuiet = (a: Asset) =>
  COLUMNS.every((c) => ACCOUNTS.every((k) => a[c][k] === "0")) &&
  a.settled === "0" &&
  (a.fees ?? "0") === "0" &&
  a.refunded === "0";

export interface PaymentReconciliationProps {
  profileId: string;
  filters: PaymentFilters;
}

// A balance summary: one line per token and store with its closing balances; a row opens its opening, changes and
// the checks that the books match the chain. Search and the status filter narrow thousands of rows.
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
  const [only, setOnly] = useState<string>(ALL);
  const [showQuiet, setShowQuiet] = useState(false);
  const [count, setCount] = useState(PAGE);
  const assets = data?.assets ?? [];
  const found = assets.filter(
    (a) => tokenMatches(a, query) || foldText(a.storeName ?? "").includes(foldText(query.trim())),
  );
  const active = query || showQuiet ? found : found.filter((a) => !isQuiet(a));
  const listed = only === ALL ? active : active.filter((a) => health(a).label === only);
  const quiet = found.length - listed.length;
  const shown = listed.slice(0, count);
  // Only what the table lists: a token with nothing in it has nothing to verify.
  const states = active.map(health);
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
          <p className="text-sm text-muted">{COPY.intro}</p>
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
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            label={COPY.search}
            placeholder={COPY.searchPlaceholder}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setCount(PAGE);
            }}
            className="min-w-0 flex-[1_1_16rem] sm:max-w-sm"
          />
          <SegmentedControl
            label={COPY.statusFilter}
            value={only}
            onValueChange={(value) => {
              setOnly(value);
              setCount(PAGE);
            }}
            options={[
              { value: ALL, label: COPY.all(active.length) },
              ...tally.map((t) => ({ value: t.label, label: `${t.label} ${t.n}` })),
            ]}
          />
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{COPY.title}</caption>
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col">{COPY.columns.asset}</th>
                  <th scope="col" className="max-lg:hidden">
                    {COPY.columns.store}
                  </th>
                  <th scope="col">{COPY.columns.status}</th>
                  {ACCOUNTS.map((account) => (
                    <th key={account} scope="col" className="text-right max-md:hidden">
                      {COPY.accounts[account]}
                    </th>
                  ))}
                  <th scope="col" className="text-right max-sm:hidden">
                    {COPY.moved}
                  </th>
                  <th scope="col" className="w-12">
                    <span className="sr-only">{COPY.expand}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((asset) => (
                  <AssetRow
                    key={`${asset.storeId}:${asset.chainId}:${asset.token}`}
                    asset={asset}
                  />
                ))}
              </tbody>
            </table>
          </div>
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

function AssetRow({ asset }: { asset: Asset }) {
  const state = health(asset);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <tr className="h-14 [&>td]:px-4 sm:[&>td]:px-5">
        <td>
          <span className="flex min-w-0 items-center gap-2">
            <TokenMark chainId={asset.chainId} symbol={asset.symbol} />
            {asset.livemode ? null : (
              // Phones keep the row's button in view; the breakdown still names the network.
              <span className="max-sm:hidden">
                <Badge tone={TONES.neutral}>{COPY.testMode}</Badge>
              </span>
            )}
          </span>
        </td>
        <td className="text-muted max-lg:hidden">{asset.storeName ?? COPY.profilePayments}</td>
        <td>
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink">
            <span aria-hidden className={`size-2 rounded-pill ${DOTS[state.tone]}`} />
            {state.label}
          </span>
        </td>
        {ACCOUNTS.map((account) => (
          <td
            key={account}
            className="text-right whitespace-nowrap text-ink tabular-nums max-md:hidden"
          >
            <PaymentAmount amount={asset.closing[account]} {...asset} />
          </td>
        ))}
        <td className="text-right whitespace-nowrap text-muted tabular-nums max-sm:hidden">
          <PaymentAmount amount={asset.settled} {...asset} />
        </td>
        <td className="text-right">
          <IconButton
            label={COPY.breakdown(asset.symbol)}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown
              aria-hidden
              className={`size-[var(--fw-icon-sm)] transition-transform duration-[var(--fw-duration-fast)] ${open ? "rotate-180" : ""}`}
            />
          </IconButton>
        </td>
      </tr>
      {open ? (
        <tr id={id}>
          <td colSpan={8} className="bg-surface-2/50 px-4 py-4 sm:px-5">
            <div className="grid gap-6 lg:grid-cols-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="pb-2 text-left font-medium">
                      {COPY.columns.account}
                    </th>
                    {COLUMNS.map((c) => (
                      <th key={c} scope="col" className="pb-2 text-right font-medium">
                        {COPY.columns[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ACCOUNTS.map((account) => (
                    <tr key={account} className="h-10">
                      <th scope="row" className="text-left font-normal text-ink">
                        {COPY.accounts[account]}
                      </th>
                      {COLUMNS.map((c) => (
                        <td key={c} className="text-right whitespace-nowrap tabular-nums">
                          <PaymentAmount amount={asset[c][account]} {...asset} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <Proof asset={asset} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

const DOTS: Record<string, string> = {
  [TONES.success]: "bg-success",
  [TONES.warning]: "bg-warning",
  [TONES.neutral]: "bg-subtle",
};

function Proof({ asset }: { asset: Asset }) {
  const block = (n: number | null) => (n === null ? COPY.unknown : String(n));
  return (
    <div className="flex flex-col gap-2">
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
        {asset.fees && asset.fees !== "0" ? (
          <DetailRow term={COPY.feesPaid}>
            <PaymentAmount amount={asset.fees} {...asset} />
          </DetailRow>
        ) : null}
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
