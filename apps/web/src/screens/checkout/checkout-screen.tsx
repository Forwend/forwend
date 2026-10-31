"use client";

import { Button, buttonClasses, EmptyState, Skeleton } from "@forwend/ui-web";
import { Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CheckoutForm } from "@/features/checkout/components/checkout-form";
import { CheckoutLive } from "@/features/checkout/components/checkout-live";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { PaymentList } from "@/features/payments/components/payment-list";
import { CHECKOUT_SOURCE } from "@/features/payments/constants/payments";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";

const RECENT = { source: CHECKOUT_SOURCE } as const;

export function CheckoutScreen() {
  const { profile } = useAppSession();
  const stores = useListStoresQuery(profile.profileId);
  const [sale, setSale] = useState<{ session: CheckoutSession; amountUsd: string } | null>(null);
  // A new form for each sale, so the last one's fields and key are gone.
  const [round, setRound] = useState(0);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        {sale ? null : <p className="text-sm text-muted">{COPY.intro}</p>}
      </header>
      {sale || stores.currentData?.length ? (
        // The sale beside the recent ones, so the page's width shows what the merchant checks next.
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {sale ? (
            <CheckoutLive
              profileId={profile.profileId}
              session={sale.session}
              amountUsd={sale.amountUsd}
              onNewSale={() => {
                setSale(null);
                setRound((n) => n + 1);
              }}
            />
          ) : (
            <CheckoutForm
              key={round}
              profileId={profile.profileId}
              stores={stores.currentData ?? []}
              onStarted={(session, amountUsd) => setSale({ session, amountUsd })}
            />
          )}
          <section aria-labelledby="checkout-recent" className="flex min-w-0 flex-col gap-3">
            <h2 id="checkout-recent" className="text-base font-semibold text-ink">
              {COPY.recent}
            </h2>
            <PaymentList
              profileId={profile.profileId}
              filters={RECENT}
              empty={{ title: COPY.noRecent, text: COPY.noRecentText }}
            />
          </section>
        </div>
      ) : stores.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.storesFailed}
          <Button size="sm" variant="secondary" onClick={() => void stores.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !stores.currentData ? (
        <Skeleton className="h-72 lg:max-w-[26rem]" />
      ) : (
        <EmptyState
          page
          icon={Store}
          title={COPY.noStores}
          description={COPY.noStoresText}
          action={
            <Link href={APP_ROUTES.newStore} className={buttonClasses({ variant: "primary" })}>
              {COPY.addStore}
            </Link>
          }
        />
      )}
    </div>
  );
}
