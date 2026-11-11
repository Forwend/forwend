"use client";

import { Button, buttonClasses, EmptyState } from "@forwend/ui-web";
import { Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CheckoutForm, CheckoutFormSkeleton } from "@/features/checkout/components/checkout-form";
import { CheckoutLive } from "@/features/checkout/components/checkout-live";
import { FADE_IN } from "@/features/checkout/components/sale-card";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PAYMENT_SOURCE } from "@/features/payments/constants/payments";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";

const RECENT = { source: PAYMENT_SOURCE.checkout } as const;
const ALL = `${APP_ROUTES.payments}?source=${PAYMENT_SOURCE.checkout}`;

export function CheckoutScreen() {
  const { profile } = useAppSession();
  const stores = useListStoresQuery(profile.profileId);
  const [sale, setSale] = useState<{ session: CheckoutSession; amountUsd: string } | null>(null);
  // A new form for each sale, so the last one's fields and key are gone.
  const [round, setRound] = useState(0);
  const list = stores.currentData;
  return (
    <div className="flex flex-col gap-6">
      {/* The desktop breadcrumb and the phone's sale screen name the page; tablets show the heading. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink max-sm:sr-only lg:sr-only">
        {COPY.title}
      </h1>
      {sale || list?.length || (!list && !stores.isError) ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* The page's first view shows at once; each sale after it fades in where the last one was. */}
          <div
            key={sale?.session.sessionId ?? round}
            className={sale || round ? `min-w-0 ${FADE_IN}` : "min-w-0"}
          >
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
            ) : list ? (
              <CheckoutForm
                profileId={profile.profileId}
                stores={list}
                onStarted={(session, amountUsd) => setSale({ session, amountUsd })}
              />
            ) : (
              <CheckoutFormSkeleton />
            )}
          </div>
          {/* The phone's sale screen leaves the shell's bottom padding out, so the list keeps its own. */}
          <section
            aria-labelledby="checkout-recent"
            className="flex min-w-0 flex-col gap-2 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
          >
            <div className="flex min-h-10 items-center justify-between gap-3">
              <h2 id="checkout-recent" className="text-base font-semibold text-ink">
                {COPY.recent}
              </h2>
              <Link href={ALL} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                {COPY.viewAll}
              </Link>
            </div>
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
