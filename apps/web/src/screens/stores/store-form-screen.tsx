"use client";

import { buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { StoreForm } from "@/features/stores/components/store-form";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { CLOSE_CHOICES, DEFAULT_CLOSE } from "@/screens/stores/lib/close-choices";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";

export interface StoreFormScreenProps {
  /** The store to edit; a new store without one. */
  storeId?: string;
}

// The store comes from the list the page above loaded (one request for all).
export function StoreFormScreen({ storeId }: StoreFormScreenProps) {
  const { profile } = useAppSession();
  const list = useListStoresQuery(profile.profileId, { skip: !storeId });
  const store = list.currentData?.find((s) => s.storeId === storeId);
  // Token configuration must load before editing acceptance.
  const tokens = useGetProfileTokensQuery(profile.profileId);
  const form = {
    profileId: profile.profileId,
    closeChoices: CLOSE_CHOICES,
    defaultClose: DEFAULT_CLOSE,
    tokens: tokens.currentData ?? [],
  };
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight break-words text-ink lg:sr-only">
          {storeId ? (store?.name ?? COPY.editTitle) : COPY.newTitle}
        </h1>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      {/* The API refuses the save too; this spares a form a Finance member could not save (D-93). */}
      {!can(profile, PERMISSIONS.storesWrite) ? (
        <p className="text-muted">
          {COPY.readOnly}{" "}
          <RecordLink href={storeId ? `${APP_ROUTES.stores}/${storeId}` : APP_ROUTES.stores}>
            {storeId ? COPY.backToStore : COPY.backToList}
          </RecordLink>
        </p>
      ) : tokens.isError ? (
        <LoadError message={COPY.tokensFailed} onRetry={() => void tokens.refetch()} />
      ) : !tokens.currentData ? (
        <Skeleton className="h-64" />
      ) : !storeId ? (
        <StoreForm key={profile.profileId} {...form} />
      ) : list.isError && !list.currentData ? (
        <LoadError message={COPY.failed} onRetry={() => void list.refetch()} />
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
