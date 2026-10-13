"use client";

import {
  Button,
  DatePicker,
  Form,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useCreateInvoiceMutation } from "@/features/invoices/api/invoices-api";
import {
  CUSTOM_EXPIRY,
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  PAY_WITH,
} from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  customExpiresIn,
  decimalText,
  invalidField,
  isReturnLink,
  parseTokenAmount,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  CreateInvoiceBody,
  ExpiryChoice,
  Invoice,
  InvoiceField,
  InvoiceToken,
  PayWith,
} from "@/features/invoices/types/invoices";
import { APP_ROUTES } from "@/shared/config/routes";
import { chainName } from "@/shared/lib/chains";

const INVALID_VALUE = 422;
const DAY_MS = 86_400_000;
type Expiry = ExpiryChoice | typeof CUSTOM_EXPIRY;
const localDate = (time: number) => new Date(time).toLocaleDateString("en-CA");

// One idempotency key per filled-in form: a double click, or a retry of the same values after an error, makes one
// invoice; changed values are a new request with a new key, never a 409. With `request` it is a personal profile's
// request (D-52): amount, note, expiry, return link and the name the payer sees, handed to onCreated instead of
// opening the invoice.
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
  // Payer chooses is the default once there is more than one token to choose from (R-56).
  const [payWith, setPayWith] = useState<PayWith>(PAY_WITH.any);
  const [picked, setPicked] = useState("");
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState<Expiry>(DEFAULT_EXPIRY);
  const [closesOn, setClosesOn] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = tokens.find((t) => tokenKey(t) === picked) ?? tokens[0];
  if (!token) return null;
  const any = payWith === PAY_WITH.any && tokens.length > 1;
  // In USD every token takes the amount, so it can have no more decimals than the token with the fewest.
  const decimals = any ? Math.min(...tokens.map((t) => t.decimals)) : token.decimals;
  const unit = any ? "USD" : token.symbol;
  const network = chainName(token.chainId);
  const today = localDate(Date.now());
  const amountError = (value: string) => {
    const units = parseTokenAmount(value, decimals);
    if (typeof units !== "string") return undefined;
    const error = COPY.amountErrors[units];
    return typeof error === "function" ? error(unit, decimals) : error;
  };
  const clear = (field: InvoiceField) => setErrors((shown) => ({ ...shown, [field]: undefined }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const showErrors = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors(shown));
      formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    };
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const units = parseTokenAmount(amount, decimals);
    const missingName = request && !text("senderName");
    const expiresIn =
      expiry === CUSTOM_EXPIRY
        ? customExpiresIn(closesOn ?? "", text("closesAt"), Date.now())
        : EXPIRY_CHOICES[expiry];
    const returnUrl = text("returnUrl");
    const badLink = returnUrl !== "" && !isReturnLink(returnUrl);
    if (typeof units === "string" || missingName || expiresIn === null || badLink) {
      showErrors({
        [INVOICE_FIELDS.amount]: typeof units === "string" ? amountError(amount) : undefined,
        [INVOICE_FIELDS.senderName]: missingName ? NEW_REQUEST_COPY.senderMissing : undefined,
        [INVOICE_FIELDS.expiresIn]: expiresIn === null ? COPY.customError : undefined,
        [INVOICE_FIELDS.returnUrl]: badLink ? COPY.returnError : undefined,
      });
      return;
    }
    const body: CreateInvoiceBody = {
      ...(any
        ? { amountUsd: decimalText(units, decimals) }
        : { chainId: token.chainId, token: token.token, amount: units.toString() }),
      expiresIn,
      title: text("title"),
      note: text("note"),
      dueDate: text("dueDate"),
      senderName: text("senderName"),
      returnUrl,
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
      // The amount field shows the API's word on either amount.
      if (field)
        showErrors({
          [field === INVOICE_FIELDS.amountUsd ? INVOICE_FIELDS.amount : field]:
            COPY.fieldErrors[field],
        });
      else setFormError(failure.status === INVALID_VALUE ? COPY.invalid : COPY.failed);
      setBusy(false);
    }
  };

  const expiryField = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* The control's own legend names it for screen readers. */}
        <p aria-hidden className="text-sm font-medium text-ink">
          {COPY.expiryLabel}
        </p>
        <SegmentedControl
          label={COPY.expiryLabel}
          value={expiry}
          onValueChange={(value) => {
            setExpiry(value);
            clear(INVOICE_FIELDS.expiresIn);
          }}
          className="self-start"
          options={[...Object.keys(EXPIRY_CHOICES), CUSTOM_EXPIRY].map((value) => ({
            value: value as Expiry,
            label: COPY.expiry[value as Expiry],
          }))}
        />
        {expiry === CUSTOM_EXPIRY ? null : <p className="text-sm text-muted">{COPY.expiryHint}</p>}
      </div>
      {expiry === CUSTOM_EXPIRY ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <DatePicker
            label={COPY.closesOn}
            value={closesOn}
            onChange={(iso) => {
              setClosesOn(iso);
              clear(INVOICE_FIELDS.expiresIn);
            }}
            min={today}
            max={localDate(Date.now() + 365 * DAY_MS)}
            error={errors[INVOICE_FIELDS.expiresIn]}
          />
          <TextField
            type="time"
            label={COPY.closesAt}
            name="closesAt"
            defaultValue="17:00"
            onChange={() => clear(INVOICE_FIELDS.expiresIn)}
          />
        </div>
      ) : null}
    </div>
  );

  const returnField = (
    <TextField
      type="url"
      label={COPY.returnLabel}
      name="returnUrl"
      inputMode="url"
      autoComplete="url"
      placeholder="https://"
      maxLength={INVOICE_LIMITS.returnUrl}
      hint={COPY.returnHint}
      error={errors[INVOICE_FIELDS.returnUrl]}
      onChange={() => clear(INVOICE_FIELDS.returnUrl)}
    />
  );

  return (
    <Form onSubmit={submit}>
      <Group title={COPY.amountGroup}>
        {tokens.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <p aria-hidden className="text-sm font-medium text-ink">
              {COPY.payWithLabel}
            </p>
            <SegmentedControl
              label={COPY.payWithLabel}
              value={payWith}
              onValueChange={(value) => {
                setPayWith(value);
                clear(INVOICE_FIELDS.amount);
              }}
              className="self-start"
              options={Object.values(PAY_WITH).map((value) => ({
                value,
                label: COPY.payWith[value],
              }))}
            />
          </div>
        ) : null}
        {any ? null : (
          <SelectField
            label={COPY.tokenLabel}
            value={tokenKey(token)}
            onValueChange={setPicked}
            options={tokens.map((t) => ({
              value: tokenKey(t),
              label: `${t.symbol} · ${chainName(t.chainId)}`,
            }))}
          />
        )}
        <TextField
          label={any ? COPY.amountUsdLabel : COPY.amountLabel}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            clear(INVOICE_FIELDS.amount);
          }}
          // Too many decimals or a comma shows when the field is left, not only on Create; empty waits for submit.
          onBlur={() =>
            amount.trim() &&
            setErrors((shown) => ({ ...shown, [INVOICE_FIELDS.amount]: amountError(amount) }))
          }
          hint={
            any
              ? COPY.payWithAnyHint(
                  [...new Set(tokens.map((t) => t.symbol))].join(" or "),
                  new Set(tokens.map((t) => t.chainId)).size,
                )
              : COPY.amountHint(token.symbol, network, token.decimals)
          }
          error={errors[INVOICE_FIELDS.amount]}
        />
      </Group>

      <Group title={COPY.detailsGroup}>
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
          <TextField
            label={NEW_REQUEST_COPY.senderLabel}
            name="senderName"
            autoComplete="name"
            defaultValue={request.senderName}
            maxLength={INVOICE_LIMITS.senderName}
            error={errors[INVOICE_FIELDS.senderName]}
          />
        ) : null}
        {returnField}
      </Group>

      <Group title={COPY.datesGroup}>
        {request ? null : (
          <DatePicker
            label={COPY.dueLabel}
            name="dueDate"
            value={dueDate}
            onChange={setDueDate}
            min={today}
            clearLabel={COPY.dueClear}
            hint={COPY.dueHint}
            error={errors[INVOICE_FIELDS.dueDate]}
            className="sm:max-w-xs"
          />
        )}
        {expiryField}
      </Group>

      {request ? null : (
        <Group title={COPY.client}>
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
        </Group>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {COPY.create}
        </Button>
        {request ? null : (
          <Link
            href={APP_ROUTES.invoices}
            className="inline-flex h-11 items-center rounded-pill px-3 text-sm text-muted hover:text-ink"
          >
            {COPY.cancel}
          </Link>
        )}
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}

// A titled group of fields; the first group has no rule above it.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5 border-line [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-6">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="text-base font-semibold text-ink">
        {title}
      </p>
      {children}
    </fieldset>
  );
}
