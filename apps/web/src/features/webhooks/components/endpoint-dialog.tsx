"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Checkbox,
  Dialog,
  SelectField,
  Switch,
  TextField,
} from "@forwend/ui-web";
import { Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useFreshSignIn } from "@/features/auth/hooks/use-fresh-sign-in";
import type { Store } from "@/features/stores/types/stores";
import { useSaveEndpointMutation } from "@/features/webhooks/api/webhooks-api";
import {
  DEFAULT_EVENTS,
  DESCRIPTION_MAX,
  URL_MAX,
  WEBHOOK_EVENTS,
} from "@/features/webhooks/constants/webhooks";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import { endpointPlace } from "@/features/webhooks/lib/webhooks";
import type { WebhookEndpoint } from "@/features/webhooks/types/webhooks";
import { invalidValue } from "@/shared/api/api-error";

export interface EndpointDialogProps {
  profileId: string;
  stores: readonly Store[] | null;
  endpoint?: WebhookEndpoint;
  trigger?: (open: () => void) => ReactNode;
}

// Not "": the select reads an empty value as nothing chosen.
const ALL_STORES = "all";

export function EndpointDialog({ profileId, stores, endpoint, trigger }: EndpointDialogProps) {
  const [save, saving] = useSaveEndpointMutation();
  const fresh = useFreshSignIn();
  const form = useRef<HTMLFormElement>(null);
  const initial = () => ({
    url: endpoint?.url ?? "",
    description: endpoint?.description ?? "",
    store: endpoint?.storeId ?? ALL_STORES,
    events: endpoint ? [...endpoint.events] : [...DEFAULT_EVENTS],
    enabled: endpoint?.enabled ?? true,
  });
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<{
    url?: string;
    description?: string;
    events?: string;
    form?: string;
  }>({});
  const set = (patch: Partial<ReturnType<typeof initial>>) =>
    setValues((v) => ({ ...v, ...patch }));
  const eventsError = useId();
  const close = () => form.current?.closest("dialog")?.close();
  // As the endpoint is now: a Turn off since must not be undone by this save.
  const load = () => {
    setValues(initial());
    setErrors({});
    saving.reset();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = values.url.trim();
    const shown: typeof errors = {};
    if (!url.startsWith("https://") || url.length > URL_MAX || !URL.canParse(url))
      shown.url = COPY.errors.url;
    if (values.description.trim().length > DESCRIPTION_MAX)
      shown.description = COPY.errors.description;
    if (values.events.length === 0) shown.events = COPY.errors.events;
    flushSync(() => setErrors(shown));
    if (Object.keys(shown).length > 0) {
      const first =
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        form.current?.querySelector<HTMLElement>('input[type="checkbox"]');
      first?.focus();
      return;
    }
    try {
      const endpointId = endpoint?.endpointId ?? crypto.randomUUID();
      await fresh.run(() =>
        save({
          profileId,
          endpointId,
          body: {
            url,
            description: values.description.trim(),
            ...(values.store === ALL_STORES ? {} : { storeId: values.store }),
            events: values.events,
            enabled: values.enabled,
          },
        }).unwrap(),
      );
      close();
    } catch (error) {
      if (fresh.cancelled(error)) return;
      // A 422 is most often an address that is not public.
      setErrors({
        form: invalidValue(error) ? COPY.errors.refused : COPY.errors.failed,
      });
    }
  };
  const title = endpoint ? COPY.editTitle(endpointPlace(endpoint.url)) : COPY.newTitle;
  return (
    <Dialog
      triggerLabel={endpoint ? COPY.edit : COPY.add}
      title={title}
      onClose={fresh.cancel}
      trigger={(open) => {
        const loadAndOpen = () => {
          load();
          open();
        };
        return trigger ? (
          trigger(loadAndOpen)
        ) : (
          <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={loadAndOpen}>
            <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.add}
          </Button>
        );
      }}
    >
      <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset disabled={fresh.pending} className="flex min-w-0 flex-col gap-4">
          <TextField
            label={COPY.url}
            type="url"
            inputMode="url"
            value={values.url}
            onChange={(event) => set({ url: event.target.value })}
            autoComplete="off"
            maxLength={URL_MAX}
            hint={COPY.urlHint}
            error={errors.url}
          />
          <TextField
            label={COPY.description}
            value={values.description}
            onChange={(event) => set({ description: event.target.value })}
            autoComplete="off"
            maxLength={DESCRIPTION_MAX}
            hint={COPY.descriptionHint}
            error={errors.description}
          />
          {stores && stores.length > 0 ? (
            <SelectField
              disabled={fresh.pending}
              label={COPY.store}
              value={values.store}
              onValueChange={(store) => set({ store })}
              options={[
                { value: ALL_STORES, label: COPY.allStores },
                ...stores.map((s) => ({ value: s.storeId, label: s.name })),
              ]}
            />
          ) : null}
          <fieldset
            className="flex flex-col gap-1"
            aria-describedby={errors.events ? eventsError : undefined}
          >
            <legend className="text-sm font-medium text-ink">{COPY.events}</legend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((type) => (
                <Checkbox
                  key={type}
                  label={COPY.eventLabels[type]}
                  checked={values.events.includes(type)}
                  onChange={(event) =>
                    set({
                      events: event.target.checked
                        ? WEBHOOK_EVENTS.filter((t) => t === type || values.events.includes(t))
                        : values.events.filter((t) => t !== type),
                    })
                  }
                />
              ))}
            </div>
            {errors.events ? (
              <p id={eventsError} role="alert" className="text-sm text-danger">
                {errors.events}
              </p>
            ) : null}
          </fieldset>
          <Switch
            label={COPY.enabled}
            checked={values.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </fieldset>
        {errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        ) : null}
        {fresh.step ?? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant={BUTTON_VARIANTS.secondary} onClick={close}>
              {COPY.cancel}
            </Button>
            <Button type="submit" loading={saving.isLoading}>
              {COPY.save}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
