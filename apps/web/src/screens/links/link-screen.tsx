"use client";
import { Badge, buttonClasses, DetailList, DetailRow, Skeleton, TONES } from "@forwend/ui-web";
import Link from "next/link";
import { useGetLinkQuery } from "@/features/links/api/links-api";
import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, linkAddress, linkState } from "@/features/links/lib/links";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { CopyValue } from "@/shared/components/copy-value";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";

export interface LinkScreenProps {
  linkId: string;
}

export function LinkScreen({ linkId }: LinkScreenProps) {
  const { profile } = useAppSession();
  const read = useGetLinkQuery({ profileId: profile.profileId, linkId });
  const link = read.currentData;
  if (!link) {
    const gone = (read.error as { status?: unknown } | undefined)?.status === 404;
    return gone ? (
      <p className="text-muted">
        {COPY.gone} <RecordLink href={APP_ROUTES.links}>{COPY.backToList}</RecordLink>
      </p>
    ) : read.isError ? (
      <LoadError
        message={COPY.failed}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
      />
    ) : (
      <Skeleton className="h-64" />
    );
  }
  const state = linkState(link, Date.now());
  const filters = { linkId };
  const purchases = `${APP_ROUTES.payments}?linkId=${linkId}`;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-xl font-semibold tracking-tight text-ink">
              {link.title}
            </h1>
            <Badge tone={state === LINK_STATES.on ? TONES.success : TONES.neutral}>
              {COPY.states[state]}
            </Badge>
            {link.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{amountLabel(link)}</p>
        </div>
        {can(profile, PERMISSIONS.invoicesWrite) ? (
          <Link
            href={`${APP_ROUTES.links}/${linkId}/edit`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            {COPY.edit}
          </Link>
        ) : null}
      </header>
      {read.isError ? (
        <LoadError
          inline
          message={COPY.stale}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
        />
      ) : null}
      {state === LINK_STATES.notReady ? (
        <p role="status" className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          {COPY.notReadyHint}
        </p>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] xl:items-start">
        <section
          aria-labelledby="link-share"
          className="fw-panel min-w-0 xl:col-start-2 xl:row-start-1"
        >
          <h2 id="link-share" className="fw-panel-head text-sm font-medium text-ink">
            {COPY.offer}
          </h2>
          <div className="px-4 py-3 sm:px-5">
            <CopyValue
              label={COPY.share}
              value={linkAddress(window.location.origin, link.slug)}
              copyLabel={COPY.copyLabel}
              hint={COPY.shareHint}
            />
          </div>
          <DetailList className="border-t border-line">
            <DetailRow term={COPY.activityRow}>
              {COPY.activity(link.visits, link.paid, link.reserved)}
            </DetailRow>
            {link.storeId ? (
              <DetailRow term={COPY.storeRow}>
                <RecordLink href={`${APP_ROUTES.stores}/${link.storeId}`}>
                  {COPY.viewStore}
                </RecordLink>
              </DetailRow>
            ) : null}
          </DetailList>
        </section>
        <section
          aria-labelledby="link-purchases"
          className="flex min-w-0 flex-col gap-3 xl:col-start-1 xl:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="link-purchases" className="text-sm font-medium text-ink">
              {COPY.purchases}
            </h2>
            <div className="flex items-center gap-2">
              <Link href={purchases} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                {COPY.allPurchases}
              </Link>
              <ExportPayments profileId={profile.profileId} filters={filters} />
            </div>
          </div>
          <PaymentList
            profileId={profile.profileId}
            filters={filters}
            empty={{ title: COPY.noPurchases, text: COPY.noPurchasesText }}
          />
        </section>
      </div>
    </div>
  );
}
