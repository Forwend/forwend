"use client";
import { Badge, Button, buttonClasses, Skeleton, TONES } from "@forwend/ui-web";
import Link from "next/link";
import { useListLinksQuery } from "@/features/links/api/links-api";
import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, linkAddress, linkState } from "@/features/links/lib/links";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { CopyValue } from "@/shared/components/copy-value";
import { APP_ROUTES } from "@/shared/config/routes";
export interface LinkScreenProps {
  linkId: string;
}
export function LinkScreen({ linkId }: LinkScreenProps) {
  const { profile } = useAppSession();
  const list = useListLinksQuery(profile.profileId);
  const link = list.currentData?.find((item) => item.linkId === linkId);
  if (!list.currentData)
    return list.isError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
        {COPY.failed}
        <Button variant="secondary" onClick={() => void list.refetch()}>
          {COPY.retry}
        </Button>
      </div>
    ) : (
      <Skeleton className="h-64" />
    );
  if (!link)
    return (
      <p className="text-muted">
        {COPY.gone}{" "}
        <Link href={APP_ROUTES.links} className="text-info underline underline-offset-4">
          {COPY.backToList}
        </Link>
      </p>
    );
  const state = linkState(link, Date.now());
  const filters = { linkId };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">
            {link.title}
          </h1>
          <p className="mt-1 text-muted">{COPY.intro}</p>
        </div>
        <Link
          href={`${APP_ROUTES.links}/${linkId}/edit`}
          className={buttonClasses({ variant: "secondary" })}
        >
          Edit payment link
        </Link>
      </header>
      {list.isError ? (
        <p role="alert" className="text-sm text-danger">
          The offer could not refresh. The last loaded values are shown.
        </p>
      ) : null}
      <section aria-labelledby="offer-summary" className="fw-panel flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="offer-summary" className="font-semibold text-ink">
            {amountLabel(link)}
          </h2>
          <span className="flex flex-wrap gap-2">
            <Badge tone={state === LINK_STATES.on ? TONES.success : TONES.neutral}>
              {COPY.states[state]}
            </Badge>
            {link.livemode ? null : <span className="text-xs text-warning">Testnet</span>}
          </span>
        </div>
        <CopyValue
          label="Share this offer"
          value={linkAddress(window.location.origin, link.slug)}
          copyLabel={COPY.copyLabel}
          hint="Customers get a new checkout for each purchase."
        />
        <p className="text-sm text-muted">{COPY.activity(link.visits, link.paid, link.reserved)}</p>
        {link.storeId ? (
          <p className="text-sm text-muted">
            Store:{" "}
            <Link
              href={`${APP_ROUTES.stores}/${link.storeId}`}
              className="text-info underline underline-offset-4"
            >
              View store settings
            </Link>
          </p>
        ) : null}
        {state === LINK_STATES.notReady ? (
          <p className="text-sm text-warning">
            Check billing details, the profile wallet and accepted tokens before sharing.
          </p>
        ) : null}
      </section>
      <section aria-labelledby="link-payments" className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="link-payments" className="text-lg font-semibold text-ink">
              Payments
            </h2>
            <p className="text-sm text-muted">Payments from this link.</p>
          </div>
          <ExportPayments profileId={profile.profileId} filters={filters} />
        </header>
        <PaymentList profileId={profile.profileId} filters={filters} />
      </section>
    </div>
  );
}
