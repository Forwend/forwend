import { Badge, StatusPill, WalletStateLabel } from "@forwend/ui-web";
import { FileText, HandCoins, Link2, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import { SOURCE_LABELS } from "@/features/payments/constants/payments";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import {
  paymentDisplayStatus,
  paymentLabel,
  paymentWallet,
  problemLabel,
} from "@/features/payments/lib/payments";
import type { Payment, PaymentProblem } from "@/features/payments/types/payments";
import { type DataColumn, DataTable } from "@/shared/components/data-table";
import { APP_ROUTES } from "@/shared/config/routes";
import { shortDate } from "@/shared/lib/dates";

type Row = Payment & { problems?: PaymentProblem[] };

const SOURCE_ICONS: Record<Payment["source"], typeof FileText> = {
  invoice: FileText,
  checkout: ShoppingCart,
  request: HandCoins,
  payment_link: Link2,
};

export interface PaymentsTableProps {
  rows: readonly Row[];
  /** Needs attention: the issue replaces the wallet column. */
  attention?: boolean;
  /** A merchant with two or more stores sees which store each payment is for. */
  showStore?: boolean;
  footer?: ReactNode;
}

export function PaymentsTable({ rows, attention, showStore, footer }: PaymentsTableProps) {
  const columns: DataColumn<Row>[] = [
    {
      key: "payment",
      header: COPY.columns.payment,
      className: "w-[22%]",
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{paymentLabel(p)}</span>
          {p.livemode ? null : <Badge tone="warning">{COPY.testnet}</Badge>}
        </span>
      ),
    },
    {
      key: "customer",
      header: COPY.columns.customer,
      from: "lg",
      cell: (p) => customer(p) ?? <span className="text-subtle">{COPY.noCustomer}</span>,
    },
    { key: "source", header: COPY.columns.source, from: "md", cell: (p) => <Source payment={p} /> },
    ...(showStore
      ? [
          {
            key: "store",
            header: COPY.columns.store,
            from: "xl",
            cell: (p: Row) => p.storeName ?? "—",
          } satisfies DataColumn<Row>,
        ]
      : []),
    {
      key: "amount",
      header: COPY.columns.amount,
      align: "end",
      cell: (p) => <Requested payment={p} />,
    },
    {
      key: "received",
      header: COPY.columns.received,
      align: "end",
      from: "lg",
      cell: (p) => <PaymentReceived payment={p} compact />,
    },
    {
      key: "status",
      header: COPY.columns.status,
      className: "w-36",
      cell: (p) => <StatusPill status={paymentDisplayStatus(p)} />,
    },
    attention
      ? {
          key: "issue",
          header: COPY.columns.issue,
          from: "md",
          cell: (p) => <Issue problems={p.problems} />,
        }
      : {
          key: "wallet",
          header: COPY.columns.wallet,
          from: "md",
          className: "w-32",
          cell: (p) => <WalletStateLabel state={paymentWallet(p)} />,
        },
    {
      key: "date",
      header: COPY.columns.date,
      align: "end",
      className: "w-24",
      cell: (p) => (
        <time dateTime={p.createdAt} className="text-muted">
          {shortDate(p.createdAt)}
        </time>
      ),
    },
  ];
  return (
    <DataTable
      label={COPY.table}
      rows={rows}
      rowKey={(p) => p.paymentId}
      rowHref={(p) => `${APP_ROUTES.payments}/${p.paymentId}`}
      rowLabel={paymentLabel}
      columns={columns}
      phone={(p) => ({
        title: paymentLabel(p),
        detail: [customer(p), SOURCE_LABELS[p.source], shortDate(p.createdAt)]
          .filter(Boolean)
          .join(" · "),
        value: <Requested payment={p} />,
        meta: <StatusPill status={paymentDisplayStatus(p)} />,
      })}
      footer={footer}
    />
  );
}

function customer(p: Payment): string | null {
  return p.customerName || p.customerEmail || null;
}

function Source({ payment }: { payment: Payment }) {
  const Icon = SOURCE_ICONS[payment.source];
  return (
    <span className="inline-flex items-center gap-2 text-muted">
      <Icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
      {SOURCE_LABELS[payment.source]}
    </span>
  );
}

// Several accepted tokens share USD terms, so the requested amount is in USD.
function Requested({ payment }: { payment: Payment }) {
  return (
    <PaymentAmount
      amount={payment.amount}
      decimals={payment.decimals}
      symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
    />
  );
}

function Issue({ problems }: { problems?: PaymentProblem[] }) {
  const [first, ...rest] = problems ?? [];
  if (!first) return <span className="text-subtle">—</span>;
  return (
    <span className="text-warning">
      {problemLabel(first.code)}
      {rest.length ? <span className="text-muted"> +{rest.length}</span> : null}
    </span>
  );
}
