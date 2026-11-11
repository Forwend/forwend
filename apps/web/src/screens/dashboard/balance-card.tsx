"use client";

import { ActionButton, Card, Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, FilePlus2, Link2, Send, ShoppingCart } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BalanceChange } from "@/features/balances/components/balance-change";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { usePricedHistory } from "@/features/balances/hooks/use-priced-balances";
import { historySeries } from "@/features/balances/lib/balance-history";
import type { Balances } from "@/features/balances/types/balances";
import type { TokenPrice } from "@/features/prices/types/prices";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { HERO_IMAGE } from "@/shared/assets/images";
import { APP_ROUTES } from "@/shared/config/routes";

export interface BalanceCardProps {
  profileId: string;
  balances: Balances | null;
  prices: readonly TokenPrice[] | undefined;
  failed: boolean;
  onRetry: () => void;
  /** Checkout belongs to merchants; a freelancer bills with invoices and links. */
  merchant: boolean;
  canBill: boolean;
  onReceive: () => void;
  /** Null where the role can't move money. Phones have no header Send, so this is their way to it. */
  onSend: (() => void) | null;
}

/** The overview's lead: what is in the wallet, its change over the past month, and the actions that bring more in. */
export function BalanceCard({
  profileId,
  balances,
  prices,
  failed,
  onRetry,
  merchant,
  canBill,
  onReceive,
  onSend,
}: BalanceCardProps) {
  const router = useRouter();
  // The Received card's default range, so the read comes from its cache.
  const history = usePricedHistory(profileId, HISTORY_RANGES[DEFAULT_RANGE]);
  const series = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.balances, prices)
    : null;
  const actions = [
    ...(canBill
      ? [
          { label: COPY.newInvoice, icon: FilePlus2, href: APP_ROUTES.newInvoice, primary: true },
          { label: COPY.newLink, icon: Link2, href: APP_ROUTES.newLink },
          ...(merchant
            ? [{ label: COPY.checkout, icon: ShoppingCart, href: APP_ROUTES.checkout }]
            : []),
        ]
      : []),
    { label: COPY.receive, icon: ArrowDownLeft, onClick: onReceive, primary: !canBill },
    ...(onSend ? [{ label: BALANCES_COPY.send, icon: Send, onClick: onSend }] : []),
  ];
  return (
    <Card id="balance-title" className="isolate flex min-h-64 flex-col overflow-hidden xl:min-h-72">
      {/* The figures sit on the surface; the art shows only on the right and fades out under them. */}
      <Image
        src={HERO_IMAGE.src}
        alt=""
        fill
        priority
        sizes="(min-width: 80rem) 50vw, 100vw"
        className="-z-10 object-cover object-[50%_75%] saturate-[.65] dark:brightness-[.45] dark:grayscale-[.7]"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--fw-surface)_0%,color-mix(in_oklab,var(--fw-surface)_92%,transparent)_42%,color-mix(in_oklab,var(--fw-surface)_35%,transparent)_80%,transparent_100%)] max-sm:bg-[color-mix(in_oklab,var(--fw-surface)_86%,transparent)]" />
      <div className="@container flex w-full flex-col items-center gap-2 sm:max-w-md sm:items-start">
        <h2 id="balance-title" className="text-sm text-muted">
          {BALANCES_COPY.totalBalance}
        </h2>
        <BalanceFigure
          balances={balances}
          prices={prices}
          failed={failed}
          onRetry={onRetry}
          // Pending payments, beside this card, shows what is moving, not final and held.
          pending={false}
          change={
            series ? (
              <BalanceChange series={series} />
            ) : history.currentData || history.isError ? null : (
              <Skeleton className="h-5 w-40" />
            )
          }
        />
      </div>
      <fieldset className="m-0 mt-auto border-0 p-0 pt-6">
        <legend className="sr-only">{COPY.actions}</legend>
        {/* Phones keep every action on one row in equal columns, as a phone app's quick actions do. */}
        <div className="grid auto-cols-fr grid-flow-col gap-1 sm:flex sm:flex-wrap sm:justify-start sm:gap-5">
          {actions.map((action) => (
            <ActionButton
              key={action.label}
              icon={action.icon}
              label={action.label}
              primary={action.primary}
              className="text-center leading-tight"
              onClick={action.onClick ?? (() => router.push(action.href ?? APP_ROUTES.home))}
            />
          ))}
        </div>
      </fieldset>
    </Card>
  );
}
