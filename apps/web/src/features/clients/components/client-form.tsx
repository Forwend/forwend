"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  ComboboxField,
  Form,
  SegmentedControl,
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
import { CLIENT_KINDS, CLIENT_LIMITS } from "@/features/clients/constants/clients";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import {
  clientCountryOptions,
  clientKind,
  invalidClientField,
} from "@/features/clients/lib/clients";
import type {
  Client,
  ClientKind,
  ClientTextField,
  SavedClientBody,
} from "@/features/clients/types/clients";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";

type Field = ClientTextField;

const KIND_OPTIONS = Object.values(CLIENT_KINDS).map((value) => ({
  value,
  label: COPY.kinds[value],
}));

export interface ClientFormProps {
  profileId: string;
  client?: Client;
}

// R-86: a new client's id is made once, so a retried save after an error makes one client.
export function ClientForm({ profileId, client }: ClientFormProps) {
  const [save] = useSaveClientMutation();
  const toast = useToast();
  const router = useRouter();
  const clientId = useRef(client?.clientId ?? crypto.randomUUID());
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  const [country, setCountry] = useState(client?.country ?? "");
  // A person has no tax ID field, so switching to one saves none.
  const [kind, setKind] = useState<ClientKind>(() => clientKind(client));
  const person = kind === CLIENT_KINDS.person;
  const back = client ? `${APP_ROUTES.clients}/${client.clientId}` : APP_ROUTES.clients;
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
      router.push(`${APP_ROUTES.clients}/${clientId.current}`);
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
        <div className="flex flex-col gap-1.5">
          {/* The control's legend names it for screen readers. */}
          <p aria-hidden className="text-sm font-medium text-ink">
            {COPY.kind}
          </p>
          <SegmentedControl
            label={COPY.kind}
            options={KIND_OPTIONS}
            value={kind}
            onValueChange={setKind}
            className="self-start"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={person ? COPY.personName : COPY.name}
            name="name"
            autoComplete="off"
            defaultValue={client?.name}
            maxLength={CLIENT_LIMITS.name}
            hint={person ? undefined : COPY.nameHint}
            error={errors.name}
          />
          <TextField
            label={person ? COPY.personEmail : COPY.email}
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={client?.email ?? ""}
            maxLength={CLIENT_LIMITS.email}
            hint={person ? COPY.personEmailHint : COPY.emailHint}
            error={errors.email}
          />
        </div>
      </FieldGroup>
      <FieldGroup title={person ? COPY.addressGroup : COPY.taxGroup}>
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
          {person ? null : (
            <TextField
              label={COPY.taxId}
              name="taxId"
              defaultValue={client?.taxId ?? ""}
              maxLength={CLIENT_LIMITS.taxId}
              hint={COPY.taxIdHint}
              error={errors.taxId}
            />
          )}
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
        <Link href={back} className={buttonClasses({ variant: "ghost" })}>
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
