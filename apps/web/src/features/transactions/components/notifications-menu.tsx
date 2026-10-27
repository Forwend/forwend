"use client";

import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Money,
  Skeleton,
} from "@forwend/ui-web";
import { ArrowDownLeft, Bell, CircleCheck, Hand, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useGetInvoiceEventsQuery } from "@/features/invoices/api/invoices-api";
import { INVOICE_EVENTS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { TRANSACTION_DIRECTIONS } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { transactionKey } from "@/features/transactions/lib/transactions";
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
  className?: string;
}

// R-81.
const EVENT_LOOK = {
  [INVOICE_EVENTS.paid]: { Icon: CircleCheck, tint: "bg-success-soft text-success" },
  [INVOICE_EVENTS.settled]: { Icon: Wallet, tint: "bg-success-soft text-success" },
  [INVOICE_EVENTS.held]: { Icon: Hand, tint: "bg-warning-soft text-warning" },
} as const;

// "New" means since the menu was last opened, remembered per profile in this browser.
export function NotificationsMenu({ profileId, transfers, className }: NotificationsMenuProps) {
  const list = useGetTransactionsQuery(
    { profileId, limit: 20 },
    { ...LIVE_QUERY, skip: !transfers },
  );
  const events = useGetInvoiceEventsQuery(profileId, LIVE_QUERY);
  // currentData: after a profile switch, never the last profile's transfers or events.
  const rows = [
    ...(list.currentData?.items ?? [])
      .filter((t) => t.direction === TRANSACTION_DIRECTIONS.in)
      .map((t) => ({ at: t.at, transfer: t, event: null })),
    ...(events.currentData ?? [])
      .filter((e) => Object.hasOwn(EVENT_LOOK, e.kind))
      .map((e) => ({ at: e.at, transfer: null, event: e })),
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
            <span className="absolute top-2 right-2 size-2 rounded-pill border border-surface bg-danger" />
          ) : null}
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="w-80">
        <MenuLabel>{TRANSACTIONS_COPY.notifications}</MenuLabel>
        {!list.currentData && list.isError ? (
          <>
            <p className="px-3 pb-1 text-sm text-muted">{TRANSACTIONS_COPY.failed}</p>
            <MenuItem
              onSelect={(e) => {
                e.preventDefault();
                list.refetch();
              }}
            >
              {TRANSACTIONS_COPY.retry}
            </MenuItem>
          </>
        ) : !list.currentData ? (
          <div className="flex flex-col gap-2 px-3 pb-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted">{TRANSACTIONS_COPY.noNotifications}</p>
        ) : (
          rows.map(({ transfer: t, event: e }) =>
            e ? (
              <MenuItem key={`event-${e.id}`} asChild>
                <Link
                  href={`${e.documentKind === "none" ? APP_ROUTES.payments : APP_ROUTES.invoices}/${e.invoiceId}`}
                  className="py-2"
                >
                  <EventIcon kind={e.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">
                      {INVOICE_COPY.events[e.kind as keyof typeof EVENT_LOOK](
                        e.number === null
                          ? (e.title ?? "Checkout payment")
                          : invoiceNumber(e.number),
                      )}{" "}
                      <Money baseUnits={BigInt(e.amount)} decimals={e.decimals} token={e.symbol} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {chainName(e.chainId)} · {TIME.format(new Date(e.at))}
                    </span>
                  </span>
                </Link>
              </MenuItem>
            ) : t ? (
              <MenuItem key={transactionKey(t)} asChild>
                <Link
                  href={`${APP_ROUTES.transactions}?${SEARCH_PARAM}=${t.txHash}`}
                  className="py-2"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-success-soft text-success">
                    <ArrowDownLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">
                      {TRANSACTIONS_COPY.receivedNote}{" "}
                      <Money baseUnits={BigInt(t.amount)} decimals={t.decimals} token={t.symbol} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {chainName(t.chainId)} · {TIME.format(new Date(t.at))}
                    </span>
                  </span>
                </Link>
              </MenuItem>
            ) : null,
          )
        )}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={APP_ROUTES.transactions}>{TRANSACTIONS_COPY.viewAll}</Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function EventIcon({ kind }: { kind: string }) {
  const look = EVENT_LOOK[kind as keyof typeof EVENT_LOOK];
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-pill ${look.tint}`}>
      <look.Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
    </span>
  );
}
