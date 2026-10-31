"use client";
import {
  Badge,
  buttonClasses,
  DetailList,
  DetailRow,
  QrCode,
  Skeleton,
  TONES,
} from "@forwend/ui-web";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { formatDueDate } from "@/features/invoices/lib/invoices";
import { useGetLinkQuery } from "@/features/links/api/links-api";
import { LinkActions } from "@/features/links/components/link-actions";
import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, linkAddress, linkState } from "@/features/links/lib/links";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { CopyValue } from "@/shared/components/copy-value";
import { DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { dateTime, shortDate } from "@/shared/lib/dates";

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
      <div className="flex flex-col gap-5 lg:gap-6">
        <DetailHeaderSkeleton
          back={{ href: APP_ROUTES.links, label: COPY.backToList }}
          icon={<Link2 aria-hidden />}
          figure={COPY.price}
          actions={<Skeleton className="h-10 w-16" />}
        />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const state = linkState(link, Date.now());
  const filters = { linkId };
  const purchases = `${APP_ROUTES.payments}?linkId=${linkId}`;
  const address = linkAddress(window.location.origin, link.slug);
  const reserved = link.reserved ?? 0;
  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <DetailHeader
        back={{ href: APP_ROUTES.links, label: COPY.backToList }}
        icon={<Link2 aria-hidden />}
        title={link.title}
        badges={
          <>
            <Badge tone={state === LINK_STATES.on ? TONES.success : TONES.neutral}>
              {COPY.states[state]}
            </Badge>
            {link.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
          </>
        }
        meta={COPY.meta(shortDate(link.createdAt))}
        figure={{ label: COPY.price, value: amountLabel(link) }}
        actions={
          can(profile, PERMISSIONS.invoicesWrite) ? (
            <LinkActions profileId={profile.profileId} link={link} />
          ) : null
        }
      />
      {read.error ? (
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
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* What the link did, at a glance: the counts the list's Activity cell reads in one line. */}
          <dl className="fw-panel grid grid-cols-3 divide-x divide-line">
            {[
              { term: COPY.stats.visits, value: link.visits },
              {
                term: COPY.stats.paid,
                value: link.paid,
                note: link.visits
                  ? COPY.paidRate(Math.round((link.paid / link.visits) * 100))
                  : null,
              },
              { term: COPY.stats.reserved, value: reserved },
            ].map((stat) => (
              <div key={stat.term} className="flex min-w-0 flex-col gap-1 px-4 py-4 sm:px-5">
                <dt className="text-sm text-muted">{stat.term}</dt>
                <dd className="text-2xl font-medium tracking-tight text-ink tabular-nums">
                  {stat.value.toLocaleString()}
                </dd>
                {stat.note ? <dd className="text-xs text-muted">{stat.note}</dd> : null}
              </div>
            ))}
          </dl>
          <section aria-labelledby="link-purchases" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="link-purchases" className="text-base font-semibold text-ink">
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
        {/* Sharing is what a link is for: on narrower screens it comes first. */}
        <aside className="flex min-w-0 flex-col gap-5 max-xl:-order-1 xl:sticky xl:top-20">
          <section aria-labelledby="link-share" className="fw-panel min-w-0">
            <h2 id="link-share" className="fw-panel-head text-base font-semibold text-ink">
              {COPY.share}
            </h2>
            <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
              <CopyValue
                label={COPY.offer}
                value={address}
                copyLabel={COPY.copyLabel}
                hint={COPY.shareHint}
                open={{ label: COPY.open, name: COPY.openName }}
              />
              {/* For a counter or a printed flyer: the phone camera opens the same page. */}
              <div className="flex items-center gap-4 rounded-md bg-surface-2 p-3">
                <QrCode value={address} label={COPY.scan} className="w-24 p-1.5" />
                <p className="text-sm text-muted">{COPY.scan}</p>
              </div>
            </div>
          </section>
          <section aria-labelledby="link-details" className="fw-panel min-w-0">
            <h2 id="link-details" className="fw-panel-head text-base font-semibold text-ink">
              {COPY.details}
            </h2>
            <DetailList>
              {link.storeId ? (
                <DetailRow term={COPY.storeRow}>
                  <RecordLink href={`${APP_ROUTES.stores}/${link.storeId}`}>
                    {COPY.viewStore}
                  </RecordLink>
                </DetailRow>
              ) : null}
              <DetailRow term={COPY.endsOnRow}>
                {link.endsAt ? formatDueDate(link.endsAt.slice(0, 10)) : COPY.noLimit}
              </DetailRow>
              <DetailRow term={COPY.capRow}>
                {link.maxPayments ? link.maxPayments.toLocaleString() : COPY.noLimit}
              </DetailRow>
              <DetailRow term={COPY.updatedRow}>{dateTime(link.updatedAt)}</DetailRow>
            </DetailList>
          </section>
        </aside>
      </div>
    </div>
  );
}
