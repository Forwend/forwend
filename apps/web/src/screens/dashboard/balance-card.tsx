"use client";

import { ActionButton, BigAmount, Card, Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, FilePlus2, Link2, ShoppingCart } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { formatUsd } from "@/features/balances/lib/balances";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { HERO_IMAGE } from "@/shared/assets/images";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface BalanceCardProps {
  /** The wallet at market prices, in cents; null without balances or a price. */
  wallet: bigint | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  /** Checkout belongs to merchants; a freelancer bills with invoices and links. */
  merchant: boolean;
  canBill: boolean;
  onReceive: () => void;
}

/** The overview's lead: what is in the wallet, what came in lately, and the actions that bring more in. */
export function BalanceCard({
  wallet,
  loading,
  failed,
  onRetry,
  merchant,
  canBill,
  onReceive,
}: BalanceCardProps) {
  const router = useRouter();
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
      <h2 id="balance-title" className="flex items-center gap-1.5 text-sm text-muted">
        {BALANCES_COPY.totalBalance}
        <span className="text-subtle">{MONEY_COPY.usd}</span>
        <EstimateHint />
      </h2>
      {failed && wallet === null ? (
        // The figure's place, between the title and the actions, which still work.
        <LoadError message={BALANCES_COPY.balancesFailed} onRetry={onRetry} />
      ) : (
        <>
          <div className="mt-1.5 min-h-14">
            {loading ? (
              <Skeleton className="h-12 w-56" />
            ) : wallet === null ? (
              <span className="text-5xl font-medium text-muted">—</span>
            ) : (
              <BigAmount value={formatUsd(wallet)} className="text-5xl" />
            )}
          </div>
        </>
      )}
      <fieldset className="m-0 mt-auto border-0 p-0 pt-6">
        <legend className="sr-only">{COPY.actions}</legend>
        <div className="flex flex-wrap gap-3 sm:gap-5">
          {actions.map((action) => (
            <ActionButton
              key={action.label}
              icon={action.icon}
              label={action.label}
              primary={action.primary}
              onClick={action.onClick ?? (() => router.push(action.href ?? APP_ROUTES.home))}
            />
          ))}
        </div>
      </fieldset>
    </Card>
  );
}
