"use client";

import { buttonClasses, DetailList, DetailRow, Skeleton } from "@forwend/ui-web";
import { FilePlus2, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { ClientActions } from "@/features/clients/components/client-actions";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { countryName } from "@/features/clients/lib/clients";
import { RESTART_PARAMS } from "@/features/invoices/constants/invoices";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { ClientInvoices } from "@/screens/clients/client-invoices";
import { DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { initials } from "@/shared/components/initials-avatar";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { shortDate } from "@/shared/lib/dates";

export interface ClientScreenProps {
  clientId: string;
}

// The client comes from the list the page above loaded (one request for all).
export function ClientScreen({ clientId }: ClientScreenProps) {
  const { profile } = useAppSession();
  const list = useListClientsQuery(profile.profileId);
  // Once deleted, the page waits to leave instead of saying the client is gone.
  const [deleted, setDeleted] = useState(false);
  const client = list.currentData?.find((c) => c.clientId === clientId);

  if (!client || deleted) {
    return list.currentData && !deleted ? (
      <p className="text-muted">
        {COPY.gone} <RecordLink href={APP_ROUTES.clients}>{COPY.backToList}</RecordLink>
      </p>
    ) : list.isError && !deleted ? (
      <LoadError
        message={COPY.failed}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    ) : (
      <div className="flex flex-col gap-6">
        <DetailHeaderSkeleton
          back={{ href: APP_ROUTES.clients, label: COPY.title }}
          icon={<UserRound aria-hidden />}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const none = <span className="text-subtle">{COPY.none}</span>;
  const letters = initials(client.name);
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        back={{ href: APP_ROUTES.clients, label: COPY.title }}
        // The list's avatar, as a record tile: the name follows it, so it says nothing to a screen reader.
        icon={
          letters ? (
            <span aria-hidden className="text-sm font-medium">
              {letters}
            </span>
          ) : (
            <UserRound aria-hidden />
          )
        }
        title={client.name}
        meta={[client.email, countryName(client.country)].filter(Boolean).join(" · ") || null}
        actions={
          <>
            {can(profile, PERMISSIONS.invoicesWrite) ? (
              <Link
                href={`${APP_ROUTES.newInvoice}?${RESTART_PARAMS.client}=${encodeURIComponent(client.clientId)}`}
                className={buttonClasses({ variant: "primary" })}
              >
                <FilePlus2 aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.newInvoice}
              </Link>
            ) : null}
            <Link
              href={`${APP_ROUTES.clients}/${client.clientId}/edit`}
              className={buttonClasses({ variant: "secondary" })}
            >
              <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.edit}
            </Link>
            <ClientActions
              profileId={profile.profileId}
              client={client}
              onDeleted={() => setDeleted(true)}
            />
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ClientInvoices profileId={profile.profileId} client={client} />
        <section aria-labelledby="client-details" className="fw-panel min-w-0 xl:sticky xl:top-20">
          <h2 id="client-details" className="fw-panel-head text-base font-semibold text-ink">
            {COPY.details}
          </h2>
          <DetailList>
            <DetailRow term={COPY.columns.email}>{client.email ?? none}</DetailRow>
            <DetailRow term={COPY.addressRow} stacked={Boolean(client.address)}>
              {client.address ?? none}
            </DetailRow>
            <DetailRow term={COPY.countryRow}>{countryName(client.country) ?? none}</DetailRow>
            <DetailRow term={COPY.taxIdRow}>{client.taxId ?? none}</DetailRow>
            <DetailRow term={COPY.referenceRow}>{client.reference ?? none}</DetailRow>
            <DetailRow term={COPY.remindersRow}>
              {client.reminders ? COPY.remindersOn : COPY.remindersOff}
            </DetailRow>
            <DetailRow term={COPY.updated}>{shortDate(client.updatedAt)}</DetailRow>
          </DetailList>
        </section>
      </div>
    </div>
  );
}
