"use client";

import { buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useGetClientQuery } from "@/features/clients/api/clients-api";
import { ClientForm } from "@/features/clients/components/client-form";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { notFound } from "@/shared/api/api-error";
import { LoadError } from "@/shared/components/load-error";
import { PageTitle } from "@/shared/components/page-title";
import { APP_ROUTES } from "@/shared/config/routes";

export interface ClientFormScreenProps {
  clientId?: string; // none: a new client
}

export function ClientFormScreen({ clientId }: ClientFormScreenProps) {
  const { profile } = useAppSession();
  const read = useGetClientQuery(
    { profileId: profile.profileId, clientId: clientId ?? "" },
    { skip: !clientId },
  );
  const client = read.currentData;
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <PageTitle className="break-words">
          {clientId ? (client?.name ?? COPY.editTitle) : COPY.newTitle}
        </PageTitle>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      {!clientId ? (
        <ClientForm key={profile.profileId} profileId={profile.profileId} />
      ) : client ? (
        // A new form per client, so it never keeps another client's values.
        <ClientForm key={client.clientId} profileId={profile.profileId} client={client} />
      ) : read.isError && !notFound(read.error) ? (
        <LoadError
          message={COPY.failed}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
        />
      ) : !read.isError ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.gone}
          <Link
            href={APP_ROUTES.clients}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.backToList}
          </Link>
        </div>
      )}
    </div>
  );
}
