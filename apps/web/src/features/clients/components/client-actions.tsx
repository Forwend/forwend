"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useDeleteClientMutation } from "@/features/clients/api/clients-api";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import type { Client } from "@/features/clients/types/clients";
import { APP_ROUTES } from "@/shared/config/routes";

export interface ClientActionsProps {
  profileId: string;
  client: Client;
  /** Called once deleted, before the page leaves for the list. */
  onDeleted: () => void;
}

// The client's actions behind one More actions menu, as on an invoice: Delete, confirmed in a dialog because it can't
// be undone. Invoices keep their copy of the client, so nothing else changes. Deleting leaves for the list.
export function ClientActions({ profileId, client, onDeleted }: ClientActionsProps) {
  const [remove, { isLoading, isError }] = useDeleteClientMutation();
  const toast = useToast();
  const router = useRouter();
  // The dialog opens once the menu has closed, so the menu does not hand focus back to its trigger over the dialog.
  const chosen = useRef(false);

  const confirm = async () => {
    try {
      await remove({ profileId, clientId: client.clientId }).unwrap();
      onDeleted();
      toast({ tone: TONES.success, title: COPY.deleted(client.name) });
      router.push(APP_ROUTES.clients);
    } catch {
      // The dialog shows the error.
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.delete}
      title={COPY.deleteTitle(client.name)}
      trigger={(openDelete) => (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
              <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
            </IconButton>
          </MenuTrigger>
          <MenuContent
            align="end"
            className="w-56"
            onCloseAutoFocus={(event) => {
              if (!chosen.current) return;
              chosen.current = false;
              event.preventDefault();
              openDelete();
            }}
          >
            <MenuItem
              className="text-danger data-[highlighted]:bg-danger-soft"
              onSelect={() => {
                chosen.current = true;
              }}
            >
              <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.delete}
            </MenuItem>
          </MenuContent>
        </Menu>
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
          onClick={confirm}
        >
          {COPY.delete}
        </Button>
      </form>
    </Dialog>
  );
}
