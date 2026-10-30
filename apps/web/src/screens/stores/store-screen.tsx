"use client";

import { buttonClasses, DetailList, DetailRow, Skeleton } from "@forwend/ui-web";
import { Pencil, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { tokensOn } from "@/features/invoices/lib/invoices";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { ProjectId } from "@/features/stores/components/project-id";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { storeLogoUrl } from "@/features/stores/lib/stores";
import { closeLabel } from "@/screens/stores/lib/close-choices";
import { assetKey } from "@/shared/components/chains/asset-selection";
import { DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { selectionSummary } from "@/shared/lib/asset-selection";
import { shortDate } from "@/shared/lib/dates";

export interface StoreScreenProps {
  storeId: string;
}

// R-134. The store comes from the list the page above loaded (one request for all). Every role that reads stores sees
// this page; only one that changes them gets Edit (D-93).
export function StoreScreen({ storeId }: StoreScreenProps) {
  const { profile } = useAppSession();
  const list = useListStoresQuery(profile.profileId);
  const tokens = useGetProfileTokensQuery(profile.profileId);
  const store = list.currentData?.find((s) => s.storeId === storeId);

  if (!store) {
    return list.currentData ? (
      <p className="text-muted">
        {COPY.gone} <RecordLink href={APP_ROUTES.stores}>{COPY.backToList}</RecordLink>
      </p>
    ) : list.isError ? (
      <LoadError
        message={COPY.failed}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    ) : (
      <div className="flex flex-col gap-6">
        <DetailHeaderSkeleton
          back={{ href: APP_ROUTES.stores, label: COPY.title }}
          icon={<Store aria-hidden />}
          // The Project ID line is as tall as its copy button.
          meta={<Skeleton className="h-6 w-64 max-w-full" />}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const none = <span className="text-subtle">{COPY.none}</span>;
  // The tokens this store's invoices offer: the profile's on, less the ones the store turns off (R-136).
  const accepted = tokens.currentData
    ? tokensOn(
        tokens.currentData.filter((t) => t.on),
        store.tokensOff,
      )
    : null;
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        back={{ href: APP_ROUTES.stores, label: COPY.title }}
        icon={<Store aria-hidden />}
        title={store.name}
        meta={<ProjectId storeId={store.storeId} />}
        actions={
          can(profile, PERMISSIONS.storesWrite) ? (
            <Link
              href={`${APP_ROUTES.stores}/${store.storeId}/edit`}
              className={buttonClasses({ variant: "secondary" })}
            >
              <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.edit}
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* As a link's purchases: the list's own actions sit at its head. */}
        <section aria-labelledby="store-payments" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="store-payments" className="text-base font-semibold text-ink">
              {COPY.latestPayments}
            </h2>
            <div className="flex items-center gap-2">
              <Link
                href={`${APP_ROUTES.payments}?storeId=${store.storeId}`}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                {COPY.payments}
              </Link>
              <ExportPayments profileId={profile.profileId} filters={{ storeId: store.storeId }} />
            </div>
          </div>
          <PaymentList
            profileId={profile.profileId}
            filters={{ storeId: store.storeId }}
            empty={{ title: COPY.noPayments, text: COPY.noPaymentsText }}
          />
        </section>
        <section aria-labelledby="store-details" className="fw-panel min-w-0 xl:sticky xl:top-20">
          <h2 id="store-details" className="fw-panel-head text-base font-semibold text-ink">
            {COPY.details}
          </h2>
          <DetailList>
            <DetailRow term={COPY.closesAfter}>{closeLabel(store.defaultExpiresIn)}</DetailRow>
            <DetailRow term={COPY.columns.origins} stacked={store.allowedOrigins.length > 0}>
              {store.allowedOrigins.length > 0 ? store.allowedOrigins.join("\n") : none}
            </DetailRow>
            <DetailRow term={COPY.tokensGroup}>
              {accepted ? (
                selectionSummary(accepted, new Set(accepted.map(assetKey)))
              ) : tokens.isError ? (
                COPY.tokensFailed
              ) : (
                <Skeleton className="h-4 w-40" />
              )}
            </DetailRow>
            <DetailRow term={COPY.logoRow}>
              {store.logoAt ? (
                // Light in both themes, as on the pay page: most logos are drawn for a light page.
                <span
                  data-theme="light"
                  className="inline-grid h-10 max-w-40 place-items-center rounded-md border border-line bg-surface px-2"
                >
                  <Image
                    src={storeLogoUrl(store.storeId, store.logoAt)}
                    alt={COPY.logoAlt(store.name)}
                    width={144}
                    height={28}
                    unoptimized
                    className="h-7 w-auto max-w-36 object-contain"
                  />
                </span>
              ) : (
                none
              )}
            </DetailRow>
            <DetailRow term={COPY.colorRow}>
              {store.brandColor ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-4 rounded-sm border border-line"
                    style={{ backgroundColor: store.brandColor }}
                  />
                  <span className="font-mono text-xs">{store.brandColor}</span>
                </span>
              ) : (
                none
              )}
            </DetailRow>
            <DetailRow term={COPY.updated}>{shortDate(store.updatedAt)}</DetailRow>
          </DetailList>
        </section>
      </div>
    </div>
  );
}
