"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  ComboboxField,
  Form,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSaveClientMutation } from "@/features/clients/api/clients-api";
import { CLIENT_LIMITS } from "@/features/clients/constants/clients";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { clientCountryOptions, invalidClientField } from "@/features/clients/lib/clients";
import type { Client, ClientTextField, SavedClientBody } from "@/features/clients/types/clients";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";

type Field = ClientTextField;

export interface ClientFormProps {
  profileId: string;
  /** The client to edit; a new one when left out. */
  client?: Client;
}

// R-86: one PUT replaces every field; the API checks them again. A new client's id is made once, so a retried save
// after an error makes one client. A save leaves for the list, so a toast says it worked.
export function ClientForm({ profileId, client }: ClientFormProps) {
  const [save] = useSaveClientMutation();
  const toast = useToast();
  const router = useRouter();
  const clientId = useRef(client?.clientId ?? crypto.randomUUID());
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  const [country, setCountry] = useState(client?.country ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: Field) => String(new FormData(form).get(name) ?? "").trim();
    const body: SavedClientBody = {
      name: value("name"),
      email: value("email"),
      address: value("address"),
      country,
      taxId: value("taxId"),
      reference: value("reference"),
      reminders: new FormData(form).get("reminders") === "on",
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
      toast({ tone: TONES.success, title: COPY.saved(body.name) });
      router.push(APP_ROUTES.clients);
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
    <Form onSubmit={submit}>
      <FieldGroup title={COPY.contactGroup}>
        <div className="grid gap-5 sm:grid-cols-2">
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
        </div>
      </FieldGroup>
      <FieldGroup title={COPY.taxGroup}>
        <TextAreaField
          label={COPY.address}
          name="address"
          defaultValue={client?.address ?? ""}
          maxLength={CLIENT_LIMITS.address}
          error={errors.address}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <ComboboxField
            label={COPY.country}
            options={countries}
            value={country}
            onValueChange={(next) => {
              setCountry(next);
              setErrors((current) => ({ ...current, country: undefined }));
            }}
            placeholder={COPY.noCountry}
            searchLabel={COPY.searchCountries}
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
      </FieldGroup>
      <FieldGroup title={COPY.invoicesGroup}>
        <TextField
          label={COPY.reference}
          name="reference"
          autoComplete="off"
          defaultValue={client?.reference ?? ""}
          maxLength={CLIENT_LIMITS.reference}
          hint={COPY.referenceHint}
          error={errors.reference}
        />
        <div className="flex flex-col">
          <Checkbox
            name="reminders"
            label={COPY.reminders}
            defaultChecked={client?.reminders ?? false}
            aria-describedby="client-reminders-hint"
          />
          <p id="client-reminders-hint" className="text-sm text-muted">
            {COPY.remindersHint}
          </p>
        </div>
      </FieldGroup>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={busy}>
          {COPY.save}
        </Button>
        <Link href={APP_ROUTES.clients} className={buttonClasses({ variant: "ghost" })}>
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
