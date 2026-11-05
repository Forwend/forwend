"use client";

import {
  Button,
  Checkbox,
  ComboboxField,
  IconButton,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatUsd } from "@/features/balances/lib/balances";
import { CLIENT_LIMITS } from "@/features/clients/constants/clients";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import { clientBody, clientCountryOptions, clientOptions } from "@/features/clients/lib/clients";
import type { ClientBody } from "@/features/clients/types/clients";
import { useCreateJobMutation } from "@/features/jobs/api/jobs-api";
import {
  EMAIL_PATTERN,
  JOB_FIELDS,
  JOB_LIMITS,
  PAYMENT_FIELDS,
} from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { centsText, dueDays, invalidJobField, usdCents } from "@/features/jobs/lib/jobs";
import type {
  CreateJobBody,
  JobField,
  PaymentDraft,
  PaymentField,
} from "@/features/jobs/types/jobs";
import { FieldGroup } from "@/shared/components/field-group";
import { FormPreview, StepForm, useFormSteps } from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

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
const INVALID_VALUE = 422;
const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };
const draft = (title: string, days: string): PaymentDraft => ({
  id: crypto.randomUUID(),
  title,
  amount: "",
  dueDays: days,
});

export interface JobFormProps {
  profileId: string;
  /** Saved clients, searched through the API (R-86, R-177): picking one fills the client fields with a copy. */
  clientSearch?: ClientSearch;
}

// R-101. One idempotency key per filled-in form: a double click or a retry makes one job.
export function JobForm({ profileId, clientSearch }: JobFormProps) {
  const [createJob] = useCreateJobMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  // The client fields are drawn again with a picked client's values, keyed by it.
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
  const depositId = useId();
  const list = useRef<HTMLUListElement>(null);
  // Add and remove take away the focused button: focus moves to the new row, or the one in its place.
  const focusRow = (row: number) =>
    list.current?.querySelectorAll("li")[row]?.querySelector("input")?.focus();
  const set = (id: string, field: keyof Omit<PaymentDraft, "id">, value: string) => {
    setPayments((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setPaymentErrors((shown) => ({ ...shown, [id]: { ...shown[id], [field]: undefined } }));
  };
  const clear = (field: JobField) => setErrors((shown) => ({ ...shown, [field]: undefined }));
  const total = payments.reduce((sum, p) => sum + (usdCents(p.amount) ?? 0n), 0n);
  const flow = useFormSteps([
    { id: STEPS.work, label: COPY.workGroup },
    { id: STEPS.client, label: COPY.clientGroup },
    { id: STEPS.payments, label: COPY.paymentsGroup },
  ]);
  // The preview reads the free-text fields as they are typed; they stay uncontrolled.
  const [typed, setTyped] = useState({ title: "", scope: "", client: "" });
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setTyped({ title: text("title"), scope: text("scope"), client: text("clientName") });
  };

  // Every problem the form has now, whichever step holds it.
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
      if (usdCents(p.amount) === null) row[PAYMENT_FIELDS.amount] = COPY.errors.amount;
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
        amountUsd: centsText(usdCents(p.amount) ?? 0n),
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
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field =
        failure.status === INVALID_VALUE
          ? invalidJobField(failure.data?.error?.message ?? "")
          : null;
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalidField[field] }));
        flow.focusError(form);
      } else
        setFormError(failure.status === INVALID_VALUE ? COPY.errors.invalid : COPY.errors.failed);
      setBusy(false);
    }
  };

  const grid =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_2.5rem]";
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
      preview={
        <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
          <div className="flex flex-col gap-4 rounded-md bg-surface p-5 text-sm shadow-sm ring-1 ring-line">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted">
                {COPY.preview.for(typed.client || COPY.preview.noClient)}
              </p>
              <p
                className={`text-lg font-semibold break-words ${typed.title ? "text-ink" : "text-subtle"}`}
              >
                {typed.title || COPY.preview.noTitle}
              </p>
              {typed.scope ? (
                <p className="line-clamp-4 break-words whitespace-pre-line text-muted">
                  {typed.scope}
                </p>
              ) : null}
            </div>
            <ol className="divide-y divide-line border-t border-line">
              {payments.map((p, i) => {
                const cents = usdCents(p.amount);
                return (
                  <li key={p.id} className="flex items-start justify-between gap-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block break-words text-ink">
                        {p.title.trim() || COPY.paymentTitle(i + 1)}
                      </span>
                      <span className="block text-xs text-muted">
                        {i === 0 && deposit
                          ? COPY.preview.onAccept
                          : COPY.preview.due(p.dueDays || "—")}
                      </span>
                    </span>
                    <span className="shrink-0 text-ink tabular-nums">
                      {cents === null ? "—" : `${formatUsd(cents)} ${MONEY_COPY.usd}`}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <span className="text-muted">{COPY.total}</span>
              <span className="font-semibold text-ink tabular-nums">
                {formatUsd(total)} {MONEY_COPY.usd}
              </span>
            </p>
          </div>
        </FormPreview>
      }
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
        <FieldGroup title={COPY.paymentsGroup}>
          <div className="flex flex-col gap-3">
            <div aria-hidden className={`${grid} max-sm:hidden text-sm font-medium text-ink`}>
              <span>{COPY.paymentColumn}</span>
              <span>{COPY.amount}</span>
              <span>{COPY.dueDays}</span>
            </div>
            <ul ref={list} className="flex flex-col gap-4 sm:gap-3">
              {payments.map((p, i) => {
                const shown = paymentErrors[p.id] ?? {};
                return (
                  <li key={p.id} className={grid}>
                    <TextField
                      label={COPY.paymentTitle(i + 1)}
                      value={p.title}
                      onChange={(event) => set(p.id, "title", event.target.value)}
                      maxLength={JOB_LIMITS.paymentTitle}
                      autoComplete="off"
                      error={shown.title}
                      className="col-span-full sm:col-span-1 sm:[&>label]:sr-only"
                    />
                    <TextField
                      label={COPY.amount}
                      aria-label={COPY.amountOf(i + 1)}
                      value={p.amount}
                      onChange={(event) => set(p.id, "amount", event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      error={shown.amount}
                      className="sm:[&>label]:sr-only"
                    />
                    <TextField
                      label={COPY.dueDays}
                      aria-label={COPY.dueDaysOf(i + 1)}
                      value={p.dueDays}
                      onChange={(event) => set(p.id, "dueDays", event.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                      error={shown.dueDays}
                      className="sm:[&>label]:sr-only"
                    />
                    <IconButton
                      label={COPY.remove(i + 1)}
                      disabled={payments.length === 1}
                      onClick={() => {
                        flushSync(() =>
                          setPayments((rows) => rows.filter((row) => row.id !== p.id)),
                        );
                        focusRow(Math.min(i, payments.length - 2));
                      }}
                      className="self-start max-sm:col-start-3 max-sm:row-start-2 max-sm:mt-7 sm:mt-0.5"
                    >
                      <X aria-hidden className="size-[var(--fw-icon-sm)]" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-muted">{COPY.dueDaysHint}</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={payments.length >= JOB_LIMITS.payments}
                onClick={() => {
                  flushSync(() => setPayments((rows) => [...rows, draft("", "14")]));
                  focusRow(payments.length);
                }}
              >
                <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.add}
              </Button>
              <p className="flex items-baseline gap-3 text-ink">
                <span className="text-sm text-muted">{COPY.total}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatUsd(total)} {MONEY_COPY.usd}
                </span>
              </p>
            </div>
            {errors[JOB_FIELDS.payments] ? (
              <p role="alert" className="text-sm text-danger">
                {errors[JOB_FIELDS.payments]}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col">
            <Checkbox
              label={COPY.deposit}
              checked={deposit}
              onChange={(event) => setDeposit(event.target.checked)}
              aria-describedby={depositId}
            />
            <p id={depositId} className="text-sm text-muted">
              {COPY.depositHint}
            </p>
          </div>
        </FieldGroup>
      </div>
    </StepForm>
  );
}
