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
  Sheet,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, KeyRound, ListChecks, Pencil, Power, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { Store } from "@/features/stores/types/stores";
import {
  useDeleteEndpointMutation,
  useRevealSecretsMutation,
  useRotateSecretMutation,
  useSaveEndpointMutation,
} from "@/features/webhooks/api/webhooks-api";
import { Deliveries } from "@/features/webhooks/components/deliveries";
import { EndpointDialog } from "@/features/webhooks/components/endpoint-dialog";
import { EndpointSecrets } from "@/features/webhooks/components/endpoint-secrets";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import { endpointPlace } from "@/features/webhooks/lib/webhooks";
import type { WebhookEndpoint, WebhookSecret } from "@/features/webhooks/types/webhooks";

export interface EndpointActionsProps {
  profileId: string;
  stores: readonly Store[] | null;
  endpoint: WebhookEndpoint;
}

type Chosen = "deliveries" | "edit" | "toggle" | "secret" | "rotate" | "delete";

// R-149: saving, the secret and its rotation need a fresh sign-in, which the API asks for (D-63); the rest do not.
export function EndpointActions({ profileId, stores, endpoint }: EndpointActionsProps) {
  const arg = { profileId, endpointId: endpoint.endpointId };
  const where = endpointPlace(endpoint.url);
  const [save] = useSaveEndpointMutation();
  const [reveal] = useRevealSecretsMutation();
  const [rotate, rotating] = useRotateSecretMutation();
  const [remove, removing] = useDeleteEndpointMutation();
  const toast = useToast();
  // What opens once the menu has closed and handed focus back (as on API keys).
  const chosen = useRef<Chosen | null>(null);
  const open = useRef<Partial<Record<"edit" | "secret" | "rotate" | "delete", () => void>>>({});
  const [sheet, setSheet] = useState(false);
  const [secrets, setSecrets] = useState<WebhookSecret[] | null>(null);
  const secretBody = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const failedToast = () => toast({ tone: TONES.danger, title: COPY.errors.action });

  const showSecrets = (list: WebhookSecret[]) => {
    setSecrets(list);
    open.current.secret?.();
  };
  const revealSecrets = async () => {
    try {
      const pending = reveal(arg);
      showSecrets(await pending.unwrap());
      // The answer held the secrets: drop them from the store too.
      pending.reset();
    } catch {
      failedToast();
    }
  };
  const toggle = async () => {
    const { url, description, storeId, events, enabled } = endpoint;
    try {
      await save({
        ...arg,
        body: { url, description, ...(storeId ? { storeId } : {}), events, enabled: !enabled },
      }).unwrap();
      toast({ tone: TONES.success, title: enabled ? COPY.turnedOff(where) : COPY.turnedOn(where) });
    } catch {
      failedToast();
    }
  };
  const confirmRotate = async (event: { currentTarget: HTMLElement }) => {
    const dialog = event.currentTarget.closest("dialog");
    setFailed(false);
    try {
      const pending = rotate(arg);
      const list = await pending.unwrap();
      pending.reset();
      dialog?.close();
      showSecrets(list);
    } catch {
      setFailed(true);
    }
  };
  const confirmDelete = async () => {
    setFailed(false);
    try {
      await remove(arg).unwrap();
      toast({ tone: TONES.success, title: COPY.deleted(where) });
    } catch {
      setFailed(true);
    }
  };
  const item = (choice: Chosen, Icon: typeof Pencil, label: string, danger = false) => (
    <MenuItem
      className={danger ? "text-danger data-[highlighted]:bg-danger-soft" : undefined}
      onSelect={() => {
        chosen.current = choice;
      }}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {label}
    </MenuItem>
  );
  const keepTrigger = (key: keyof typeof open.current) => (fn: () => void) => {
    open.current[key] = fn;
    return null;
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={COPY.actions(where)} title={COPY.actions(where)} size="md">
            <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
          </IconButton>
        </MenuTrigger>
        <MenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(event) => {
            const choice = chosen.current;
            if (!choice) return;
            chosen.current = null;
            // These open nothing at once, so focus goes back to the menu button.
            if (choice === "toggle") return void toggle();
            if (choice === "secret") return void revealSecrets();
            event.preventDefault();
            if (choice === "deliveries") return setSheet(true);
            open.current[choice]?.();
          }}
        >
          {item("deliveries", ListChecks, COPY.deliveries)}
          {item("edit", Pencil, COPY.edit)}
          {item("toggle", Power, endpoint.enabled ? COPY.turnOff : COPY.turnOn)}
          {item("secret", KeyRound, COPY.secret)}
          {item("rotate", RefreshCw, COPY.rotate)}
          {item("delete", Trash2, COPY.delete, true)}
        </MenuContent>
      </Menu>
      <EndpointDialog
        profileId={profileId}
        stores={stores}
        endpoint={endpoint}
        trigger={keepTrigger("edit")}
      />
      <Dialog
        triggerLabel={COPY.secretTitle}
        title={COPY.secretTitle}
        onClose={() => setSecrets(null)}
        trigger={keepTrigger("secret")}
      >
        <div ref={secretBody}>
          {secrets ? (
            <EndpointSecrets
              secrets={secrets}
              onDone={() => secretBody.current?.closest("dialog")?.close()}
            />
          ) : null}
        </div>
      </Dialog>
      <Dialog
        triggerLabel={COPY.rotate}
        title={COPY.rotateTitle(where)}
        onClose={() => setFailed(false)}
        trigger={keepTrigger("rotate")}
      >
        <p>{COPY.rotateBody}</p>
        {failed ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {COPY.errors.action}
          </p>
        ) : null}
        <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
            {COPY.keep}
          </Button>
          <Button type="button" loading={rotating.isLoading} onClick={(e) => void confirmRotate(e)}>
            {COPY.rotateSubmit}
          </Button>
        </form>
      </Dialog>
      <Dialog
        triggerLabel={COPY.delete}
        title={COPY.deleteTitle(where)}
        onClose={() => setFailed(false)}
        trigger={keepTrigger("delete")}
      >
        <p>{COPY.deleteBody}</p>
        {failed ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {COPY.errors.action}
          </p>
        ) : null}
        <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
            {COPY.keep}
          </Button>
          <Button
            type="button"
            variant={BUTTON_VARIANTS.danger}
            loading={removing.isLoading}
            onClick={() => void confirmDelete()}
          >
            {COPY.delete}
          </Button>
        </form>
      </Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title={COPY.deliveriesTitle(where)}>
        {sheet ? <Deliveries profileId={profileId} endpoint={endpoint} /> : null}
      </Sheet>
    </>
  );
}
