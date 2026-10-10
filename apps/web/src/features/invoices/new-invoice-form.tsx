"use client";

import { Button, SegmentedControl, SelectField, TextAreaField, TextField } from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  type InvoiceField,
  type InvoiceToken,
  invalidField,
  parseTokenAmount,
  tokenKey,
} from "@/features/invoices/invoices";
import { useCreateInvoiceMutation } from "@/features/invoices/invoices-api";
import { NEW_INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";
import { chainName } from "@/shared/chains/chains";
import { APP_ROUTES } from "@/shared/config/routes";

const INVALID_VALUE = 422;

// One idempotency key per filled-in form: a double click, or a retry of the same values after an error, makes one
// invoice; changed values are a new request with a new key, never a 409.
export function NewInvoiceForm({
  profileId,
  tokens,
}: {
  profileId: string;
  tokens: readonly InvoiceToken[];
}) {
  const [createInvoice] = useCreateInvoiceMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [picked, setPicked] = useState("");
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY);
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = tokens.find((t) => tokenKey(t) === picked) ?? tokens[0];
  if (!token) return null;
  const network = chainName(token.chainId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const showErrors = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors(shown));
      formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    };
    const units = parseTokenAmount(amount, token.decimals);
    if (typeof units === "string") {
      const error = COPY.amountErrors[units];
      showErrors({
        [INVOICE_FIELDS.amount]:
          typeof error === "string" ? error : error(token.symbol, token.decimals),
      });
      return;
    }
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const body = {
      chainId: token.chainId,
      token: token.token,
      amount: units.toString(),
      expiresIn: EXPIRY_CHOICES[expiry],
      title: text("title"),
      note: text("note"),
      dueDate: text("dueDate"),
      client: {
        name: text("clientName"),
        email: text("clientEmail"),
        address: text("clientAddress"),
      },
    };
    setErrors({});
    setFormError("");
    setBusy(true);
    try {
      const values = JSON.stringify(body);
      const key = keys.current.get(values) ?? crypto.randomUUID();
      keys.current.set(values, key);
      const invoice = await createInvoice({ profileId, idempotencyKey: key, body }).unwrap();
      router.push(`${APP_ROUTES.invoices}/${invoice.invoiceId}`);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field =
        failure.status === INVALID_VALUE ? invalidField(failure.data?.error?.message ?? "") : null;
      if (field) showErrors({ [field]: COPY.fieldErrors[field] });
      else setFormError(failure.status === INVALID_VALUE ? COPY.invalid : COPY.failed);
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <SelectField
        label={COPY.tokenLabel}
        value={tokenKey(token)}
        onValueChange={setPicked}
        options={tokens.map((t) => ({
          value: tokenKey(t),
          label: `${t.symbol} · ${chainName(t.chainId)}`,
        }))}
      />
      <TextField
        label={COPY.amountLabel}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={amount}
        onChange={(event) => {
          setAmount(event.target.value);
          setErrors((shown) => ({ ...shown, [INVOICE_FIELDS.amount]: undefined }));
        }}
        hint={COPY.amountHint(token.symbol, network, token.decimals)}
        error={errors[INVOICE_FIELDS.amount]}
      />
      <TextField
        label={COPY.titleLabel}
        name="title"
        maxLength={INVOICE_LIMITS.title}
        placeholder={COPY.titlePlaceholder}
        error={errors[INVOICE_FIELDS.title]}
      />
      <TextAreaField
        label={COPY.noteLabel}
        name="note"
        maxLength={INVOICE_LIMITS.note}
        error={errors[INVOICE_FIELDS.note]}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          type="date"
          label={COPY.dueLabel}
          name="dueDate"
          hint={COPY.dueHint}
          error={errors[INVOICE_FIELDS.dueDate]}
        />
        <div className="flex flex-col gap-1.5">
          {/* The control's own legend names it for screen readers. */}
          <p aria-hidden className="text-sm font-medium text-ink">
            {COPY.expiryLabel}
          </p>
          <SegmentedControl
            label={COPY.expiryLabel}
            value={expiry}
            onValueChange={setExpiry}
            className="self-start"
            options={Object.keys(EXPIRY_CHOICES).map((value) => ({
              value: value as ExpiryChoice,
              label: COPY.expiry[value as ExpiryChoice],
            }))}
          />
          <p className="text-sm text-muted">{COPY.expiryHint}</p>
        </div>
      </div>
      <fieldset className="flex flex-col gap-5 border-t border-line pt-5">
        <legend className="sr-only">{COPY.client}</legend>
        <p aria-hidden className="text-base font-semibold text-ink">
          {COPY.client}
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={COPY.clientName}
            name="clientName"
            autoComplete="off"
            maxLength={INVOICE_LIMITS.clientName}
            error={errors[INVOICE_FIELDS.clientName]}
          />
          <TextField
            type="email"
            label={COPY.clientEmail}
            name="clientEmail"
            autoComplete="off"
            maxLength={INVOICE_LIMITS.clientEmail}
            error={errors[INVOICE_FIELDS.clientEmail]}
          />
        </div>
        <TextAreaField
          label={COPY.clientAddress}
          name="clientAddress"
          maxLength={INVOICE_LIMITS.clientAddress}
          error={errors[INVOICE_FIELDS.clientAddress]}
        />
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {COPY.create}
        </Button>
        <Link
          href={APP_ROUTES.invoices}
          className="rounded-pill px-3 py-2 text-sm text-muted hover:text-ink"
        >
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </form>
  );
}
