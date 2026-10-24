"use client";

import { Button, buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { StoreForm } from "@/features/stores/components/store-form";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { CLOSE_CHOICES, DEFAULT_CLOSE } from "@/screens/stores/lib/close-choices";
import { APP_ROUTES } from "@/shared/config/routes";

export interface StoreScreenProps {
  /** The store to edit; a new store without one. */
  storeId?: string;
}

// The store comes from the list the page above loaded (one request for all).
export function StoreScreen({ storeId }: StoreScreenProps) {
  const { profile } = useAppSession();
  const list = useListStoresQuery(profile.profileId, { skip: !storeId });
  const store = list.currentData?.find((s) => s.storeId === storeId);
  const form = {
    profileId: profile.profileId,
    closeChoices: CLOSE_CHOICES,
    defaultClose: DEFAULT_CLOSE,
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight break-words text-ink lg:sr-only">
          {storeId ? (store?.name ?? COPY.editTitle) : COPY.newTitle}
        </h1>
        <p className="text-muted">{COPY.intro}</p>
      </header>
      {!storeId ? (
        <StoreForm key={profile.profileId} {...form} />
      ) : list.isError && !list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData ? (
        <Skeleton className="h-96" />
      ) : store ? (
        // A new form per store, so it never keeps another store's values.
        <StoreForm key={store.storeId} {...form} store={store} />
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.gone}
          <Link
            href={APP_ROUTES.stores}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.backToList}
          </Link>
        </div>
      )}
    </div>
  );
}
