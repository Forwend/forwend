"use client";

import { ComboboxField, TextAreaField, TextField } from "@forwend/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CLIENT_LIMITS } from "@/features/clients/constants/clients";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import { clientBody, clientCountryOptions, clientOptions } from "@/features/clients/lib/clients";
import type { ClientBody } from "@/features/clients/types/clients";
import { useCreateJobMutation } from "@/features/jobs/api/jobs-api";
import { JobFormPreview } from "@/features/jobs/components/job-form-preview";
import { PaymentScheduleFields } from "@/features/jobs/components/payment-schedule-fields";
import { JOB_FIELDS, JOB_LIMITS, PAYMENT_FIELDS } from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { dueDays, paymentCents } from "@/features/jobs/lib/jobs";
import type {
  CreateJobBody,
  JobField,
  PaymentDraft,
  PaymentField,
} from "@/features/jobs/types/jobs";
import { invalidValue, namedField } from "@/shared/api/api-error";
import { FieldGroup } from "@/shared/components/field-group";
import { StepForm } from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { EMAIL_PATTERN } from "@/shared/constants/email";
import { useFormSteps } from "@/shared/hooks/use-form-steps";
import { usdFromCents } from "@/shared/lib/money";

const COPY = JOBS_COPY.form;
const STEPS = { work: "work", client: "client", payments: "payments" } as const;
const FIELD_STEPS: Record<JobField, string> = {
  [JOB_FIELDS.title]: STEPS.work,
  [JOB_FIELDS.scope]: STEPS.work,
  [JOB_FIELDS.clientName]: STEPS.client,
  [JOB_FIELDS.clientEmail]: STEPS.client,
  [JOB_FIELDS.clientAddress]: STEPS.client,
  [JOB_FIELDS.clientCountry]: STEPS.client,
  [JOB_FIELDS.clientTaxId]: STEPS.client,
  [JOB_FIELDS.payments]: STEPS.payments,
};
const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };
const draft = (title: string, days: string): PaymentDraft => ({
  id: crypto.randomUUID(),
  title,
  amount: "",
  dueDays: days,
});

export interface JobFormProps {
  profileId: string;
  clientSearch?: ClientSearch;
}

// One idempotency key per filled-in form, so a double click or retry makes one job.
export function JobForm({ profileId, clientSearch }: JobFormProps) {
  const [createJob] = useCreateJobMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  const [fill, setFill] = useState({ key: "", client: NO_CLIENT });
  const [country, setCountry] = useState("");
  const [payments, setPayments] = useState(() => [
    draft(COPY.defaults.deposit, "7"),
    draft(COPY.defaults.final, "14"),
  ]);
  const [deposit, setDeposit] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<JobField, string>>>({});
  const [paymentErrors, setPaymentErrors] = useState<
    Record<string, Partial<Record<PaymentField, string>>>
  >({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (id: string, field: PaymentField, value: string) => {
    setPayments((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setPaymentErrors((shown) => ({ ...shown, [id]: { ...shown[id], [field]: undefined } }));
  };
  const clear = (field: JobField) => setErrors((shown) => ({ ...shown, [field]: undefined }));
  const total = payments.reduce((sum, p) => sum + (paymentCents(p.amount) ?? 0n), 0n);
  const flow = useFormSteps([
    { id: STEPS.work, label: COPY.workGroup },
    { id: STEPS.client, label: COPY.clientGroup },
    { id: STEPS.payments, label: COPY.paymentsGroup },
  ]);
  const [typed, setTyped] = useState({ title: "", scope: "", client: "" });
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setTyped({ title: text("title"), scope: text("scope"), client: text("clientName") });
  };

  const problems = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const shown: Partial<Record<JobField, string>> = {};
    if (!text("title")) shown[JOB_FIELDS.title] = COPY.errors.required;
    if (!text("clientName")) shown[JOB_FIELDS.clientName] = COPY.errors.required;
    if (!EMAIL_PATTERN.test(text("clientEmail"))) shown[JOB_FIELDS.clientEmail] = COPY.errors.email;
    const rows: typeof paymentErrors = {};
    for (const p of payments) {
      const row: Partial<Record<PaymentField, string>> = {};
      if (!p.title.trim()) row[PAYMENT_FIELDS.title] = COPY.errors.required;
      if (paymentCents(p.amount) === null) row[PAYMENT_FIELDS.amount] = COPY.errors.amount;
      if (dueDays(p.dueDays) === null) row[PAYMENT_FIELDS.dueDays] = COPY.errors.dueDays;
      if (Object.keys(row).length > 0) rows[p.id] = row;
    }
    return { shown, rows };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const { shown, rows } = problems(form);
    flushSync(() => {
      setErrors(shown);
      setPaymentErrors(rows);
      setFormError("");
    });
    if (Object.keys(shown).length > 0 || Object.keys(rows).length > 0) return flow.focusError(form);
    const body: CreateJobBody = {
      title: text("title"),
      scope: text("scope"),
      client: {
        name: text("clientName"),
        email: text("clientEmail"),
        address: text("clientAddress"),
        country,
        taxId: text("clientTaxId"),
      },
      payments: payments.map((p, i) => ({
        title: p.title.trim(),
        amountUsd: usdFromCents(paymentCents(p.amount) ?? 0n),
        dueDays: dueDays(p.dueDays) ?? 0,
        onAccept: i === 0 && deposit,
      })),
    };
    const values = JSON.stringify(body);
    const key = keys.current.get(values) ?? crypto.randomUUID();
    keys.current.set(values, key);
    setBusy(true);
    try {
      const job = await createJob({ profileId, idempotencyKey: key, body }).unwrap();
      router.push(`${APP_ROUTES.jobs}/${job.jobId}`);
    } catch (error) {
      const field = invalidValue(error) ? namedField(error, Object.values(JOB_FIELDS)) : null;
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalidField[field] }));
        flow.focusError(form);
      } else setFormError(invalidValue(error) ? COPY.errors.invalid : COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <StepForm
      label={COPY.stepsLabel}
      flow={flow}
      editing={false}
      cancelHref={APP_ROUTES.jobs}
      copy={{ ...COPY, save: COPY.create }}
      busy={busy}
      onContinue={(form) => {
        const { shown } = problems(form);
        const here = Object.fromEntries(
          Object.entries(shown).filter(([field]) => FIELD_STEPS[field as JobField] === flow.at),
        );
        flushSync(() => setErrors(here));
        if (Object.keys(here).length === 0) return true;
        flow.focusError(form);
        return false;
      }}
      onSubmit={submit}
      onInput={readTyped}
      error={formError}
      preview={<JobFormPreview typed={typed} payments={payments} deposit={deposit} total={total} />}
    >
      <div data-step={STEPS.work} className={flow.shows(STEPS.work)}>
        <FieldGroup title={COPY.workGroup}>
          <TextField
            label={COPY.jobTitle}
            name="title"
            autoComplete="off"
            maxLength={JOB_LIMITS.title}
            hint={COPY.jobTitleHint}
            error={errors[JOB_FIELDS.title]}
            onChange={() => clear(JOB_FIELDS.title)}
          />
          <TextAreaField
            label={COPY.scope}
            name="scope"
            maxLength={JOB_LIMITS.scope}
            hint={COPY.scopeHint}
            error={errors[JOB_FIELDS.scope]}
          />
        </FieldGroup>
      </div>

      <div data-step={STEPS.client} className={flow.shows(STEPS.client)}>
        <FieldGroup title={COPY.clientGroup}>
          {clientSearch?.any ? (
            <ComboboxField
              label={COPY.savedClient}
              placeholder={COPY.savedClientPlaceholder}
              searchLabel={COPY.searchClients}
              options={clientOptions(clientSearch.clients)}
              valueLabel={fill.client.name}
              loading={clientSearch.pending}
              noResults={clientSearch.failed ? COPY.clientsFailed : undefined}
              onSearchChange={clientSearch.search}
              value={fill.key}
              onValueChange={(clientId) => {
                const picked = clientSearch.clients.find((c) => c.clientId === clientId);
                if (!picked) return;
                const values = clientBody(picked);
                setFill({ key: clientId, client: values });
                setCountry(values.country);
                setErrors((shown) => ({
                  ...shown,
                  [JOB_FIELDS.clientName]: undefined,
                  [JOB_FIELDS.clientEmail]: undefined,
                  [JOB_FIELDS.clientAddress]: undefined,
                  [JOB_FIELDS.clientCountry]: undefined,
                  [JOB_FIELDS.clientTaxId]: undefined,
                }));
              }}
            />
          ) : null}
          <div key={fill.key} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={COPY.clientName}
                name="clientName"
                defaultValue={fill.client.name}
                autoComplete="off"
                maxLength={CLIENT_LIMITS.name}
                error={errors[JOB_FIELDS.clientName]}
              />
              <TextField
                type="email"
                label={COPY.clientEmail}
                name="clientEmail"
                defaultValue={fill.client.email}
                autoComplete="off"
                maxLength={CLIENT_LIMITS.email}
                hint={COPY.clientEmailHint}
                error={errors[JOB_FIELDS.clientEmail]}
              />
            </div>
            <TextAreaField
              label={COPY.clientAddress}
              name="clientAddress"
              defaultValue={fill.client.address}
              maxLength={CLIENT_LIMITS.address}
              error={errors[JOB_FIELDS.clientAddress]}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <ComboboxField
                label={COPY.clientCountry}
                options={countries}
                placeholder={COPY.noCountry}
                searchLabel={COPY.searchCountries}
                value={country}
                onValueChange={(next) => {
                  setCountry(next);
                  clear(JOB_FIELDS.clientCountry);
                }}
                error={errors[JOB_FIELDS.clientCountry]}
              />
              <TextField
                label={COPY.clientTaxId}
                name="clientTaxId"
                defaultValue={fill.client.taxId}
                autoComplete="off"
                maxLength={CLIENT_LIMITS.taxId}
                error={errors[JOB_FIELDS.clientTaxId]}
              />
            </div>
          </div>
        </FieldGroup>
      </div>

      <div data-step={STEPS.payments} className={flow.shows(STEPS.payments)}>
        <PaymentScheduleFields
          payments={payments}
          errors={paymentErrors}
          error={errors[JOB_FIELDS.payments]}
          total={total}
          deposit={deposit}
          onDeposit={setDeposit}
          onEdit={edit}
          onAdd={() => setPayments((rows) => [...rows, draft("", "14")])}
          onRemove={(id) => setPayments((rows) => rows.filter((row) => row.id !== id))}
        />
      </div>
    </StepForm>
  );
}
