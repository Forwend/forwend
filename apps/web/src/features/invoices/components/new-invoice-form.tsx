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
  type Invoice,
  type InvoiceField,
  type InvoiceToken,
  invalidField,
  parseTokenAmount,
  tokenKey,
} from "@/features/invoices/invoices";
import { useCreateInvoiceMutation } from "@/features/invoices/invoices-api";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/invoices-copy";
import { chainName } from "@/shared/chains/chains";
import { APP_ROUTES } from "@/shared/config/routes";

const INVALID_VALUE = 422;

// One idempotency key per filled-in form: a double click, or a retry of the same values after an error, makes one
// invoice; changed values are a new request with a new key, never a 409. With `request` it is a personal profile's
// request (D-52): amount, note, expiry and the name the payer sees, handed to onCreated instead of opening the invoice.
export function NewInvoiceForm({
  profileId,
  tokens,
  request,
}: {
  profileId: string;
  tokens: readonly InvoiceToken[];
  request?: { senderName: string; onCreated: (invoice: Invoice) => void };
}) {
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
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
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const units = parseTokenAmount(amount, token.decimals);
    const missingName = request && !text("senderName");
    if (typeof units === "string" || missingName) {
      const amountError = typeof units === "string" ? COPY.amountErrors[units] : undefined;
      showErrors({
        [INVOICE_FIELDS.amount]:
          typeof amountError === "function"
            ? amountError(token.symbol, token.decimals)
            : amountError,
        [INVOICE_FIELDS.senderName]: missingName ? NEW_REQUEST_COPY.senderMissing : undefined,
      });
      return;
    }
    const body = {
      chainId: token.chainId,
      token: token.token,
      amount: units.toString(),
      expiresIn: EXPIRY_CHOICES[expiry],
      title: text("title"),
      note: text("note"),
      dueDate: text("dueDate"),
      senderName: text("senderName"),
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
      if (request) request.onCreated(invoice);
      else router.push(`${APP_ROUTES.invoices}/${invoice.invoiceId}`);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field =
        failure.status === INVALID_VALUE ? invalidField(failure.data?.error?.message ?? "") : null;
      if (field) showErrors({ [field]: COPY.fieldErrors[field] });
      else setFormError(failure.status === INVALID_VALUE ? COPY.invalid : COPY.failed);
      setBusy(false);
    }
  };

  const expiryField = (
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
  );

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
      {request ? null : (
        <TextField
          label={COPY.titleLabel}
          name="title"
          maxLength={INVOICE_LIMITS.title}
          placeholder={COPY.titlePlaceholder}
          error={errors[INVOICE_FIELDS.title]}
        />
      )}
      <TextAreaField
        label={COPY.noteLabel}
        name="note"
        maxLength={INVOICE_LIMITS.note}
        error={errors[INVOICE_FIELDS.note]}
      />
      {request ? (
        <>
          {expiryField}
          <TextField
            label={NEW_REQUEST_COPY.senderLabel}
            name="senderName"
            autoComplete="name"
            defaultValue={request.senderName}
            maxLength={INVOICE_LIMITS.senderName}
            error={errors[INVOICE_FIELDS.senderName]}
          />
        </>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              type="date"
              label={COPY.dueLabel}
              name="dueDate"
              hint={COPY.dueHint}
              error={errors[INVOICE_FIELDS.dueDate]}
            />
            {expiryField}
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
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {COPY.create}
        </Button>
        {request ? null : (
          <Link
            href={APP_ROUTES.invoices}
            className="rounded-pill px-3 py-2 text-sm text-muted hover:text-ink"
          >
            {COPY.cancel}
          </Link>
        )}
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </form>
  );
}
