"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  ComboboxField,
  Form,
  SegmentedControl,
  Stepper,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
  // A new client is entered a group at a time; editing shows every field at once, since one change is the usual
  // case. Every step stays mounted, so going back keeps what was typed.
  const steps = client
    ? []
    : [
        { id: "contact", label: COPY.contactGroup },
        { id: "address", label: person ? COPY.addressGroup : COPY.taxGroup },
        { id: "invoices", label: COPY.invoicesGroup },
      ];
  const [step, setStep] = useState(0);
  const shows = (id: string) =>
    steps.length === 0 || steps[step]?.id === id ? "contents" : "hidden";
  const last = steps.length === 0 || step === steps.length - 1;
  const contactProblems = (form: HTMLFormElement) => {
    const value = (name: Field) => String(new FormData(form).get(name) ?? "").trim();
    const shown: Partial<Record<Field, string>> = {};
    if (!value("name")) shown.name = COPY.errors.required;
    if (value("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email")))
      shown.email = COPY.errors.email;
    return shown;
  };
  const focusError = (form: HTMLFormElement) => {
    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    const at = invalid?.closest<HTMLElement>("[data-step]")?.dataset.step;
    const index = steps.findIndex((s) => s.id === at);
    if (index >= 0) flushSync(() => setStep(index));
    invalid?.focus();
  };
  const next = (form: HTMLFormElement | null) => {
    if (!form) return;
    if (steps[step]?.id === "contact") {
      const shown = contactProblems(form);
      flushSync(() => setErrors(shown));
      if (Object.keys(shown).length > 0) return focusError(form);
    }
    setStep(step + 1);
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
    if (Object.keys(shown).length > 0) return focusError(form);
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
        focusError(form);
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit}>
      {steps.length ? (
        <Stepper label={COPY.stepsLabel} steps={steps} current={step} onStepClick={setStep} />
      ) : null}
      <div data-step="contact" className={shows("contact")}>
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
      <div data-step="address" className={shows("address")}>
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
      <div data-step="invoices" className={shows("invoices")}>
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
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:gap-3">
        {step > 0 ? (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.back}
          </Button>
        ) : (
          <Link href={back} className={buttonClasses({ variant: "ghost" })}>
            {COPY.cancel}
          </Link>
        )}
        <span className="hidden flex-1 sm:block" />
        {/* Keys keep these two separate elements: reusing one would turn Continue into a submit mid-click. */}
        {last ? (
          <Button key="save" type="submit" loading={busy}>
            {COPY.save}
          </Button>
        ) : (
          <Button
            key="continue"
            onClick={(event) => {
              event.preventDefault();
              next(event.currentTarget.form);
            }}
          >
            {COPY.continue}
            <ArrowRight aria-hidden className="size-[var(--fw-icon-sm)]" />
          </Button>
        )}
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
