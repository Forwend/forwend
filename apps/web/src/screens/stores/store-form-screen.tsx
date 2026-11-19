"use client";

import { buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { useGetStoreQuery } from "@/features/stores/api/stores-api";
import { StoreForm } from "@/features/stores/components/store-form";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { CLOSE_CHOICES, DEFAULT_CLOSE } from "@/screens/stores/lib/close-choices";
import { notFound } from "@/shared/api/server-reach";
import { LoadError } from "@/shared/components/load-error";
import { PageTitle } from "@/shared/components/page-title";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";

export interface StoreFormScreenProps {
  storeId?: string; // none: a new store
}

export function StoreFormScreen({ storeId }: StoreFormScreenProps) {
  const { profile } = useAppSession();
  const read = useGetStoreQuery(
    { profileId: profile.profileId, storeId: storeId ?? "" },
    { skip: !storeId },
  );
  const store = read.currentData;
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
        <PageTitle className="break-words">
          {storeId ? (store?.name ?? COPY.editTitle) : COPY.newTitle}
        </PageTitle>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
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
      ) : store ? (
        // A new form per store, so it never keeps another store's values.
        <StoreForm key={store.storeId} {...form} store={store} />
      ) : read.isError && !notFound(read.error) ? (
        <LoadError message={COPY.failed} onRetry={() => void read.refetch()} />
      ) : !read.isError ? (
        <Skeleton className="h-96" />
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
