"use client";

import {
  Button,
  Form,
  SelectField,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSaveClientMutation } from "@/features/clients/api/clients-api";
import { CLIENT_LIMITS, NO_COUNTRY } from "@/features/clients/constants/clients";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { clientCountryOptions, invalidClientField } from "@/features/clients/lib/clients";
import type { Client, ClientBody } from "@/features/clients/types/clients";

type Field = keyof ClientBody;

export interface ClientFormProps {
  profileId: string;
  /** The client to edit; a new one when left out. */
  client?: Client;
  onDone: () => void;
}

// R-86: one PUT replaces every field; the API checks them again. A new client's id is made once, so a retried save
// after an error makes one client.
export function ClientForm({ profileId, client, onDone }: ClientFormProps) {
  const [save] = useSaveClientMutation();
  const toast = useToast();
  const clientId = useRef(client?.clientId ?? crypto.randomUUID());
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  const [country, setCountry] = useState(client?.country ?? NO_COUNTRY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: Field) => String(new FormData(form).get(name) ?? "").trim();
    const body: ClientBody = {
      name: value("name"),
      email: value("email"),
      address: value("address"),
      country: country === NO_COUNTRY ? "" : country,
      taxId: value("taxId"),
    };
    const shown: Partial<Record<Field, string>> = {};
    if (!body.name) shown.name = COPY.errors.required;
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      shown.email = COPY.errors.email;
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    try {
      await save({ profileId, clientId: clientId.current, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved });
      onDone();
    } catch (error) {
      const message =
        (error as { data?: { error?: { message?: string } } }).data?.error?.message ?? "";
      const field = invalidClientField(message);
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit} gap="md">
      <TextField
        label={COPY.name}
        name="name"
        autoComplete="off"
        defaultValue={client?.name}
        maxLength={CLIENT_LIMITS.name}
        error={errors.name}
      />
      <TextField
        label={COPY.email}
        name="email"
        type="email"
        autoComplete="off"
        defaultValue={client?.email ?? ""}
        maxLength={CLIENT_LIMITS.email}
        hint={COPY.emailHint}
        error={errors.email}
      />
      <TextAreaField
        label={COPY.address}
        name="address"
        defaultValue={client?.address ?? ""}
        maxLength={CLIENT_LIMITS.address}
        error={errors.address}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label={COPY.country}
          options={countries}
          value={country}
          onValueChange={(next) => {
            setCountry(next);
            setErrors((current) => ({ ...current, country: undefined }));
          }}
          error={errors.country}
        />
        <TextField
          label={COPY.taxId}
          name="taxId"
          defaultValue={client?.taxId ?? ""}
          maxLength={CLIENT_LIMITS.taxId}
          hint={COPY.taxIdHint}
          error={errors.taxId}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={busy}>
          {COPY.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {COPY.cancel}
        </Button>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
