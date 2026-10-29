"use client";

import { Button, buttonClasses, EmptyState, Skeleton } from "@forwend/ui-web";
import { Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CheckoutForm } from "@/features/checkout/components/checkout-form";
import { CheckoutLive } from "@/features/checkout/components/checkout-live";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";

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
      ) : stores.isError && !stores.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.storesFailed}
          <Button size="sm" variant="secondary" onClick={() => void stores.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !stores.currentData ? (
        <Skeleton className="h-72 max-w-2xl" />
      ) : stores.currentData.length === 0 ? (
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
      ) : (
        <div className="max-w-2xl">
          <CheckoutForm
            key={round}
            profileId={profile.profileId}
            stores={stores.currentData}
            onStarted={(session, amountUsd) => setSale({ session, amountUsd })}
          />
        </div>
      )}
    </div>
  );
}
