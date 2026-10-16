"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Pencil, Trash2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useDeleteClientMutation } from "@/features/clients/api/clients-api";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import type { Client } from "@/features/clients/types/clients";

const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });

export interface ClientListProps {
  profileId: string;
  clients: readonly Client[];
  onEdit: (client: Client) => void;
  /** The empty list's call to add the first client. */
  addAction: ReactNode;
}

export function ClientList({ profileId, clients, onEdit, addAction }: ClientListProps) {
  if (clients.length === 0) {
    return (
      <EmptyState icon={Users} title={COPY.empty} description={COPY.emptyText} action={addAction} />
    );
  }
  return (
    <ul className="fw-panel divide-y divide-line sm:rounded-lg">
      {clients.map((client) => (
        <li key={client.clientId} className="flex items-start gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1 text-sm break-words">
            <p className="font-medium text-ink">{client.name}</p>
            <p className="mt-0.5 text-muted">
              {[
                client.email,
                client.country ? (COUNTRY.of(client.country) ?? client.country) : null,
                client.taxId,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <IconButton label={COPY.edit(client.name)} size="sm" onClick={() => onEdit(client)}>
            <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
          </IconButton>
          <DeleteClient profileId={profileId} client={client} />
        </li>
      ))}
    </ul>
  );
}

function DeleteClient({ profileId, client }: { profileId: string; client: Client }) {
  const [remove, { isLoading, isError }] = useDeleteClientMutation();
  const toast = useToast();
  return (
    <Dialog
      triggerLabel={COPY.delete(client.name)}
      title={COPY.deleteTitle(client.name)}
      trigger={(open) => (
        <IconButton label={COPY.delete(client.name)} size="sm" onClick={open}>
          <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      )}
    >
      <p>{COPY.deleteBody}</p>
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.deleteFailed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.deleteKeep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={async () => {
            try {
              await remove({ profileId, clientId: client.clientId }).unwrap();
              toast({ tone: TONES.success, title: COPY.deleted });
            } catch {
              // The dialog shows the error.
            }
          }}
        >
          {COPY.deleteConfirm}
        </Button>
      </form>
    </Dialog>
  );
}
