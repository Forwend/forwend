"use client";

import {
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Money,
  Skeleton,
  shortAddress,
} from "@forwend/ui-web";
import {
  ArrowDownLeft,
  Bell,
  BellOff,
  CircleCheck,
  Hand,
  type LucideIcon,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useGetInvoiceEventsQuery } from "@/features/invoices/api/invoices-api";
import { INVOICE_EVENTS } from "@/features/invoices/constants/invoices";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";
import { paymentLabel } from "@/features/payments/lib/payments";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { transactionKey } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { SEARCH_PARAM } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";

const SHOWN = 6;
const SEEN_KEY = "forwend:notifications-seen:";
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const COPY = TRANSACTIONS_COPY.bell;

function readSeen(profileId: string): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY + profileId)) || 0;
  } catch {
    return 0;
  }
}

export interface NotificationsMenuProps {
  profileId: string;
  /** Whether the profile's role reads its transactions (D-93); without, only the invoice events show. */
  transfers: boolean;
  /** Where View all leads: Payments for a business, Transactions for a personal profile. */
  viewAllHref: string;
  className?: string;
}

const LOOK = {
  done: { Icon: CircleCheck, tint: "bg-success-soft text-success" },
  wallet: { Icon: Wallet, tint: "bg-success-soft text-success" },
  held: { Icon: Hand, tint: "bg-warning-soft text-warning" },
  received: { Icon: ArrowDownLeft, tint: "bg-success-soft text-success" },
  waiting: { Icon: ArrowDownLeft, tint: "bg-surface-2 text-muted" },
} satisfies Record<string, { Icon: LucideIcon; tint: string }>;

// R-81.
const EVENTS = {
  [INVOICE_EVENTS.paid]: { what: COPY.paid, look: LOOK.done },
  [INVOICE_EVENTS.settled]: { what: COPY.inWallet, look: LOOK.wallet },
  [INVOICE_EVENTS.held]: { what: COPY.held, look: LOOK.held },
} as const;

interface Row {
  key: string;
  at: string;
  href: string;
  /** What happened, then the payment or sender it names. */
  title: string;
  detail: string;
  look: (typeof LOOK)[keyof typeof LOOK];
  amount: Pick<InvoiceEvent, "amount" | "decimals" | "symbol">;
}

const eventRow = (e: InvoiceEvent): Row | null => {
  const known = EVENTS[e.kind as keyof typeof EVENTS];
  if (!known) return null;
  const name = paymentLabel({
    reference: null,
    number: e.number,
    title: e.title ?? null,
    paymentId: e.invoiceId,
  });
  return {
    key: `event-${e.id}`,
    at: e.at,
    href: `${APP_ROUTES.payments}/${e.invoiceId}`,
    title: `${known.what} · ${name}`,
    detail: `${chainName(e.chainId)} · ${TIME.format(new Date(e.at))}`,
    look: known.look,
    amount: e,
  };
};

// A transfer that pays a payment is that payment's money reaching the wallet; any other is money sent to the address.
const transferRow = (t: Transaction): Row => {
  const paymentId = t.payment?.paymentId ?? t.invoice?.invoiceId;
  const confirming = t.status !== TRANSACTION_STATUSES.confirmed;
  const name = t.invoice
    ? invoiceNumber(t.invoice.number)
    : paymentId
      ? paymentLabel({ reference: null, number: null, title: null, paymentId })
      : shortAddress(t.counterparty);
  return {
    key: transactionKey(t),
    at: t.at,
    href: paymentId
      ? `${APP_ROUTES.payments}/${paymentId}`
      : `${APP_ROUTES.transactions}?${SEARCH_PARAM}=${t.txHash}`,
    // Still confirming, it is on its way, not in the wallet.
    title: `${confirming ? COPY.confirming : paymentId ? COPY.inWallet : COPY.received} · ${name}`,
    detail: `${chainName(t.chainId)} · ${TIME.format(new Date(t.at))}`,
    look: confirming ? LOOK.waiting : paymentId ? LOOK.wallet : LOOK.received,
    amount: t,
  };
};

// "New" means since the menu was last opened, remembered per profile in this browser.
export function NotificationsMenu({
  profileId,
  transfers,
  viewAllHref,
  className,
}: NotificationsMenuProps) {
  const list = useGetTransactionsQuery(
    { profileId, limit: 20 },
    { ...LIVE_QUERY, skip: !transfers },
  );
  const events = useGetInvoiceEventsQuery(profileId, LIVE_QUERY);
  // currentData: after a profile switch, never the last profile's transfers or events.
  const settled = new Set(
    (events.currentData ?? [])
      .filter((event) => event.kind === INVOICE_EVENTS.settled)
      .map((event) => event.invoiceId),
  );
  const failed =
    (!events.currentData && events.isError) || (transfers && !list.currentData && list.isError);
  const loading =
    (!events.currentData && !events.isError) || (transfers && !list.currentData && !list.isError);
  // A settled payment's own event already says its money is in the wallet, so its transfer is not listed again.
  const rows = [
    ...(list.currentData?.items ?? [])
      .filter(
        (t) =>
          t.direction === TRANSACTION_DIRECTIONS.in &&
          !settled.has(t.payment?.paymentId ?? t.invoice?.invoiceId ?? ""),
      )
      .map(transferRow),
    ...(events.currentData ?? []).flatMap((e) => eventRow(e) ?? []),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, SHOWN);
  const [seen, setSeen] = useState(0);
  useEffect(() => setSeen(readSeen(profileId)), [profileId]);
  const fresh = rows.filter((r) => new Date(r.at).getTime() > seen).length;

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY + profileId, String(now));
    } catch {
      // Storage blocked: the count resets on the next visit.
    }
  };

  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <IconButton
          label={
            fresh
              ? `${TRANSACTIONS_COPY.notifications}, ${TRANSACTIONS_COPY.newCount(fresh)}`
              : TRANSACTIONS_COPY.notifications
          }
          size="md"
          className={className}
        >
          <Bell aria-hidden className="size-[var(--fw-icon-md)]" />
          {fresh ? (
            <span className="absolute top-2 right-2 size-2 rounded-pill bg-accent ring-2 ring-bg" />
          ) : null}
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="w-96">
        <MenuLabel>{TRANSACTIONS_COPY.notifications}</MenuLabel>
        {failed ? (
          <>
            <p className="px-3 pb-1 text-sm text-muted">{COPY.failed}</p>
            <MenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (transfers) void list.refetch();
                void events.refetch();
              }}
            >
              {TRANSACTIONS_COPY.retry}
            </MenuItem>
          </>
        ) : loading ? (
          <div aria-hidden className="flex flex-col gap-1 px-3 pb-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-8 shrink-0 rounded-pill" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </span>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={BellOff} title={TRANSACTIONS_COPY.noNotifications} />
        ) : (
          rows.map((row) => (
            <MenuItem key={row.key} asChild>
              <Link href={row.href} className="gap-3 py-2">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-pill ${row.look.tint}`}
                >
                  <row.look.Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-ink">{row.title}</span>{" "}
                    <Money
                      baseUnits={BigInt(row.amount.amount)}
                      decimals={row.amount.decimals}
                      token={row.amount.symbol}
                      className="shrink-0 text-ink"
                    />
                  </span>{" "}
                  <span className="block truncate text-xs text-muted">{row.detail}</span>
                </span>
              </Link>
            </MenuItem>
          ))
        )}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={viewAllHref}>{TRANSACTIONS_COPY.viewAll}</Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
