"use client";

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Money,
  Skeleton,
} from "@forwend/ui-web";
import { ArrowDownLeft, Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  className?: string;
}

// "New" means received since the menu was last opened, remembered per profile in this browser.
export function NotificationsMenu({ profileId, className }: NotificationsMenuProps) {
  const list = useGetTransactionsQuery({ profileId, limit: 20 }, LIVE_QUERY);
  // currentData: after a profile switch, never the last profile's transfers.
  const received = (list.currentData?.items ?? [])
    .filter((t) => t.direction === TRANSACTION_DIRECTIONS.in)
    .slice(0, SHOWN);
  const [seen, setSeen] = useState(0);
  useEffect(() => setSeen(readSeen(profileId)), [profileId]);
  const fresh = received.filter((t) => new Date(t.at).getTime() > seen).length;

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
      <MenuTrigger
        aria-label={
          fresh
            ? `${TRANSACTIONS_COPY.notifications}, ${TRANSACTIONS_COPY.newCount(fresh)}`
            : TRANSACTIONS_COPY.notifications
        }
        className={`relative grid size-11 place-items-center rounded-md text-muted lg:size-9 outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2 data-[state=open]:text-ink ${className ?? ""}`}
      >
        <Bell aria-hidden className="size-[var(--fw-icon-md)]" />
        {fresh ? (
          <span className="absolute top-1.5 right-1.5 size-2 rounded-pill border border-surface bg-danger" />
        ) : null}
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
        ) : received.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted">{TRANSACTIONS_COPY.noNotifications}</p>
        ) : (
          received.map((t) => (
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
          ))
        )}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={APP_ROUTES.transactions}>{TRANSACTIONS_COPY.viewAll}</Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
