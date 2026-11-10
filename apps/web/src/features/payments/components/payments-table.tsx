import { Badge, StatusPill, WalletStateLabel } from "@forwend/ui-web";
import type { ReactNode } from "react";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import { SOURCE_ICONS, SOURCE_LABELS } from "@/features/payments/constants/payments";
import {
  PAYMENTS_COPY as COPY,
  PAYMENT_DETAIL_COPY,
} from "@/features/payments/constants/payments-copy";
import {
  heldHint,
  paymentDisplayStatus,
  paymentLabel,
  paymentWallet,
  problemLabel,
} from "@/features/payments/lib/payments";
import type { Payment, PaymentProblem } from "@/features/payments/types/payments";
import { ChainBadge, hasChainBadge } from "@/shared/components/chains/chain-badge";
import { NearIntents } from "@/shared/components/chains/near-intents";
import { type DataColumn, DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName } from "@/shared/lib/chains";
import { dayTime, timeOfDay } from "@/shared/lib/dates";

type Row = Payment & { problems?: PaymentProblem[] };

export interface PaymentsTableProps {
  rows: readonly Row[];
  /** Issues: the issue replaces the wallet and date columns. */
  attention?: boolean;
  /** A merchant with two or more stores sees which store each payment is for. */
  showStore?: boolean;
  footer?: ReactNode;
}

// The row icon names the source and the network; the payment page says both in words.
function paymentColumns(attention?: boolean, showStore?: boolean): DataColumn<Row>[] {
  return [
    {
      key: "payment",
      header: COPY.columns.payment,
      placeholder: "lead",
      title: paymentLabel,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <PaymentIcon payment={p} />
          <span className="truncate font-medium text-ink">
            {paymentLabel(p)}
            <PaymentWords payment={p} />
          </span>
          {/* Quiet on every row, so it doesn't outshout the statuses that need action. */}
          {p.livemode ? null : <Badge tone="neutral">{COPY.testnet}</Badge>}
          {/* R-239: paid from another chain; the payment page says from which. */}
          {p.crossChain ? <ViaNearIntents /> : null}
        </span>
      ),
    },
    {
      key: "customer",
      header: COPY.columns.customer,
      className: "w-34",
      title: customer,
      cell: (p) => customer(p) ?? <span className="text-subtle">{COPY.noCustomer}</span>,
    },
    ...(showStore
      ? [
          {
            key: "store",
            header: COPY.columns.store,
            from: "xl",
            className: "w-32",
            cell: (p: Row) => p.storeName ?? "—",
          } satisfies DataColumn<Row>,
        ]
      : []),
    // The issue needs the room in Issues; the payment's page has its date and wallet.
    ...(attention
      ? []
      : [
          {
            key: "date",
            header: COPY.columns.date,
            from: "md",
            fit: true,
            cell: (p) => (
              <time dateTime={p.createdAt} className="text-muted tabular-nums">
                {dayTime(p.createdAt)}
              </time>
            ),
          } satisfies DataColumn<Row>,
        ]),
    {
      key: "status",
      header: COPY.columns.status,
      placeholder: "pill",
      fit: true,
      cell: (p) => <StatusPill status={paymentDisplayStatus(p)} />,
    },
    attention
      ? {
          key: "issue",
          header: COPY.columns.issue,
          className: "w-[24%]",
          title: (p) => issueText(p.problems),
          cell: (p) => <Issue problems={p.problems} />,
        }
      : {
          key: "wallet",
          header: COPY.columns.wallet,
          from: "md",
          className: "w-25",
          cell: (p) => <WalletStateLabel state={paymentWallet(p)} />,
        },
    {
      key: "amount",
      header: COPY.columns.amount,
      align: "end",
      className: "w-44",
      cell: (p) => <PaymentReceived payment={p} compact />,
    },
  ];
}

export function PaymentsTable({ rows, attention, showStore, footer }: PaymentsTableProps) {
  return (
    <DataTable
      label={COPY.table}
      rows={rows}
      rowKey={(p) => p.paymentId}
      rowHref={(p) => `${APP_ROUTES.payments}/${p.paymentId}`}
      rowLabel={paymentLabel}
      columns={paymentColumns(attention, showStore)}
      day={(p) => p.createdAt}
      phone={(p) => ({
        leading: <PaymentIcon payment={p} large />,
        title: (
          <>
            {paymentLabel(p)}
            <PaymentWords payment={p} />
            {p.livemode ? null : (
              <>
                {" "}
                <Badge tone="neutral">{COPY.testnet}</Badge>
              </>
            )}
          </>
        ),
        time: <time dateTime={p.createdAt}>{timeOfDay(p.createdAt)}</time>,
        value: <PaymentReceived payment={p} compact />,
        detail: (
          <>
            {customer(p) ?? <span className="text-subtle">{COPY.noCustomer}</span>}
            {p.crossChain ? (
              <span className="ml-1.5 border-l border-line-strong pl-2">
                <ViaNearIntents bare />
              </span>
            ) : null}
          </>
        ),
        meta: <StatusPill status={paymentDisplayStatus(p)} />,
      })}
      footer={footer}
    />
  );
}

/** The table's loading form: its real headers and each cell's shape, and phone rows under a day heading. */
export function PaymentsTableSkeleton({
  attention,
  showStore,
}: Pick<PaymentsTableProps, "attention" | "showStore">) {
  return (
    <DataTableSkeleton
      columns={paymentColumns(attention, showStore)}
      leading
      days
      status
      count={SKELETON_ROWS}
      className="fw-panel"
    />
  );
}

function customer(p: Payment): string | null {
  return p.customerName || p.customerEmail || null;
}

// Before the customer chooses among several tokens, the payment can arrive on any of their networks.
const anyNetwork = (p: Payment) => p.optionCount > 1 && !p.optionLocked;

/** The round icon that leads a row: the source, with the network's logo on its corner, as on Transactions. */
function PaymentIcon({ payment, large = false }: { payment: Payment; large?: boolean }) {
  const Icon = SOURCE_ICONS[payment.source];
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-pill bg-surface-2 text-muted ${large ? "size-9" : "size-7"}`}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {anyNetwork(payment) ? null : <ChainBadge chainId={payment.chainId} />}
    </span>
  );
}

/** The icon's source and network in words for screen readers; the network shows only when no logo can carry it. */
function PaymentWords({ payment }: { payment: Payment }) {
  const network = anyNetwork(payment) ? MONEY_COPY.anyNetwork : chainName(payment.chainId);
  return (
    <>
      <span className="sr-only">, {SOURCE_LABELS[payment.source]}</span>
      {anyNetwork(payment) || hasChainBadge(payment.chainId) ? (
        <span className="sr-only">, {network}</span>
      ) : (
        <span className="font-normal text-muted"> · {network}</span>
      )}
    </>
  );
}

/** NEAR's mark and name in a quiet outline; bare inside a line that already sets it apart. */
function ViaNearIntents({ bare = false }: { bare?: boolean }) {
  return (
    <span
      title={PAYMENT_DETAIL_COPY.crossChain.title}
      className={
        bare
          ? "text-xs"
          : "inline-flex h-6 shrink-0 items-center rounded-sm border border-line px-1.5 text-xs"
      }
    >
      <span className="sr-only">{PAYMENT_DETAIL_COPY.crossChain.via} </span>
      <NearIntents />
    </span>
  );
}

// A real problem leads; held money is the customer's and needs nothing from the owner (D-118).
function byConcern(problems?: PaymentProblem[]): PaymentProblem[] {
  return [...(problems ?? [])].sort(
    (a, b) => Number(a.code === "held_funds") - Number(b.code === "held_funds"),
  );
}

function issueText(problems?: PaymentProblem[]): string | null {
  const sorted = byConcern(problems);
  const [first, ...rest] = sorted;
  if (!first) return null;
  // Only held money: its hover is the status badge's sentences.
  if (first.code === "held_funds") return heldHint(sorted) ?? problemLabel(first);
  return rest.length ? `${problemLabel(first)} and ${rest.length} more` : problemLabel(first);
}

function Issue({ problems }: { problems?: PaymentProblem[] }) {
  const [first, ...rest] = byConcern(problems);
  if (!first) return <span className="text-subtle">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-ink">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-pill ${first.code === "held_funds" ? "bg-subtle" : "bg-warning"}`}
      />
      <span className="truncate">{problemLabel(first)}</span>
      {rest.length ? <span className="shrink-0 text-muted">+{rest.length}</span> : null}
    </span>
  );
}
