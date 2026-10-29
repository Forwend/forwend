"use client";

import {
  Checkbox,
  ComboboxField,
  SegmentedControl,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
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
import { FormPreview, StepForm, useFormSteps } from "@/shared/components/step-form";
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
  const flow = useFormSteps([
    { id: "contact", label: COPY.contactGroup },
    { id: "address", label: person ? COPY.addressGroup : COPY.taxGroup },
    { id: "invoices", label: COPY.invoicesGroup },
  ]);
  const contactProblems = (form: HTMLFormElement) => {
    const value = (name: Field) => String(new FormData(form).get(name) ?? "").trim();
    const shown: Partial<Record<Field, string>> = {};
    if (!value("name")) shown.name = COPY.errors.required;
    if (value("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email")))
      shown.email = COPY.errors.email;
    return shown;
  };
  // The preview reads the free-text fields as they are typed; they stay uncontrolled.
  const [typed, setTyped] = useState(() => ({
    name: client?.name ?? "",
    email: client?.email ?? "",
    address: client?.address ?? "",
    taxId: client?.taxId ?? "",
    reference: client?.reference ?? "",
    reminders: client?.reminders ?? false,
  }));
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const text = (name: Field) => String(data.get(name) ?? "").trim();
    setTyped({
      name: text("name"),
      email: text("email"),
      address: text("address"),
      taxId: text("taxId"),
      reference: text("reference"),
      reminders: data.get("reminders") === "on",
    });
  };
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
    const shown = contactProblems(form);
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) return flow.focusError(form);
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
        flow.focusError(form);
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <StepForm
      label={COPY.stepsLabel}
      flow={flow}
      editing={Boolean(client)}
      cancelHref={back}
      copy={COPY}
      busy={busy}
      onContinue={(form) => {
        if (flow.at !== "contact") return true;
        const shown = contactProblems(form);
        flushSync(() => setErrors(shown));
        if (Object.keys(shown).length === 0) return true;
        flow.focusError(form);
        return false;
      }}
      onSubmit={submit}
      onInput={readTyped}
      error={formError}
      preview={
        <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
          <ClientPreview
            {...typed}
            kind={kind}
            country={country ? (countries.find((c) => c.value === country)?.label ?? "") : ""}
          />
        </FormPreview>
      }
    >
      <div data-step="contact" className={flow.shows("contact")}>
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
      </div>
      <div data-step="address" className={flow.shows("address")}>
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
      </div>
      <div data-step="invoices" className={flow.shows("invoices")}>
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
      </div>
    </StepForm>
  );
}

function ClientPreview({
  name,
  email,
  address,
  country,
  taxId,
  reference,
  reminders,
  kind,
}: {
  name: string;
  email: string;
  address: string;
  country: string;
  taxId: string;
  reference: string;
  reminders: boolean;
  kind: ClientKind;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-surface p-5 text-sm shadow-sm ring-1 ring-line">
        <p className="text-xs font-medium text-muted">{COPY.preview.billedTo}</p>
        <p className={`mt-1 font-medium break-words ${name ? "text-ink" : "text-subtle"}`}>
          {name || COPY.preview.noName}
        </p>
        {[email, address, country].filter(Boolean).map((line) => (
          <p key={line} className="break-words whitespace-pre-line text-muted">
            {line}
          </p>
        ))}
        {taxId && kind === CLIENT_KINDS.business ? (
          <p className="text-muted">
            {COPY.preview.taxId} {taxId}
          </p>
        ) : null}
        {reference ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs font-medium text-muted">{COPY.preview.reference}</p>
            <p className="break-words text-ink">{reference}</p>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        {reminders ? COPY.preview.remindersOn : COPY.preview.remindersOff}
      </p>
    </div>
  );
}
