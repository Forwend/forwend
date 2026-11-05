"use client";

import { BUTTON_VARIANTS, Button, Checkbox, Dialog, SelectField, TextField } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useCreateKeyMutation } from "@/features/api-keys/api/api-keys-api";
import { KEY_NAME_MAX, KEY_SCOPES } from "@/features/api-keys/constants/api-keys";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import type { KeyScope } from "@/features/api-keys/types/api-keys";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import type { Store } from "@/features/stores/types/stores";

export interface NewKeyDialogProps {
  profileId: string;
  /** A merchant's stores, one of which the key is for; null for a freelancer, whose key has none. */
  stores: readonly Store[] | null;
  /** Gets the new key's text, the one time the API answers it. */
  onMade: (secret: string) => void;
}

// Most keys make and read invoices; anything more is a choice.
const DEFAULT_SCOPES: KeyScope[] = [PERMISSIONS.invoicesRead, PERMISSIONS.invoicesWrite];

// R-144: the API asks for a fresh sign-in first when the last one is older than 15 minutes (D-63).
export function NewKeyDialog({ profileId, stores, onMade }: NewKeyDialogProps) {
  const [create, creating] = useCreateKeyMutation();
  const fresh = useFreshSignIn();
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [store, setStore] = useState(stores?.[0]?.storeId ?? "");
  const [scopes, setScopes] = useState<KeyScope[]>(DEFAULT_SCOPES);
  const [errors, setErrors] = useState<{ name?: string; scopes?: string; form?: string }>({});
  const close = () => form.current?.closest("dialog")?.close();
  const reset = () => {
    setName("");
    setStore(stores?.[0]?.storeId ?? "");
    setScopes(DEFAULT_SCOPES);
    setErrors({});
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const shown: typeof errors = {};
    if (!name.trim() || name.trim().length > KEY_NAME_MAX) shown.name = COPY.errors.name;
    if (scopes.length === 0) shown.scopes = COPY.errors.scopes;
    flushSync(() => setErrors(shown));
    if (Object.keys(shown).length > 0) {
      const first =
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        form.current?.querySelector<HTMLElement>('input[type="checkbox"]');
      first?.focus();
      return;
    }
    try {
      const pending = create({
        profileId,
        body: { name: name.trim(), ...(stores ? { storeId: store } : {}), scopes },
      });
      const made = await fresh.run(() => pending.unwrap());
      onMade(made.secret);
      // The answer held the secret: drop it from the store too. The hook's reset would be this render's, a no-op.
      pending.reset();
      close();
    } catch (error) {
      if (!fresh.cancelled(error)) setErrors({ form: COPY.errors.failed });
    }
  };
  return (
    <Dialog
      triggerLabel={COPY.add}
      title={COPY.newTitle}
      onClose={() => {
        fresh.cancel();
        reset();
      }}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.add}
        </Button>
      )}
    >
      <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {/* While the user confirms it's them, the key they confirm stays shown as it is. */}
        <fieldset disabled={fresh.pending} className="flex min-w-0 flex-col gap-4">
          <TextField
            label={COPY.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            maxLength={KEY_NAME_MAX}
            hint={COPY.nameHint}
            error={errors.name}
          />
          {stores && stores.length > 1 ? (
            <SelectField
              disabled={fresh.pending}
              label={COPY.store}
              value={store}
              onValueChange={setStore}
              options={stores.map((s) => ({ value: s.storeId, label: s.name }))}
            />
          ) : null}
          <fieldset
            className="flex flex-col gap-1"
            aria-describedby={
              errors.scopes ? "key-scopes-hint key-scopes-error" : "key-scopes-hint"
            }
          >
            <legend className="text-sm font-medium text-ink">{COPY.scopes}</legend>
            <p id="key-scopes-hint" className="text-sm text-muted">
              {COPY.scopesHint}
            </p>
            {KEY_SCOPES.map((scope) => (
              <Checkbox
                key={scope}
                label={COPY.scopeLabels[scope]}
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  setScopes(
                    event.target.checked
                      ? KEY_SCOPES.filter((s) => s === scope || scopes.includes(s))
                      : scopes.filter((s) => s !== scope),
                  )
                }
              />
            ))}
            {errors.scopes ? (
              <p id="key-scopes-error" role="alert" className="text-sm text-danger">
                {errors.scopes}
              </p>
            ) : null}
          </fieldset>
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
            <Button type="submit" loading={creating.isLoading}>
              {COPY.make}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
