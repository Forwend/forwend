"use client";

import {
  Button,
  buttonClasses,
  ComboboxField,
  DatePicker,
  Form,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import { Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clientBody, clientCountryOptions } from "@/features/clients/lib/clients";
import type { Client, ClientBody } from "@/features/clients/types/clients";
import { useCreateInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { type LineFieldErrors, LineItems } from "@/features/invoices/components/line-items";
import { NewInvoicePreview } from "@/features/invoices/components/new-invoice-preview";
import {
  AMOUNT_ERRORS,
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
  dueCheckoutDate,
  dueCheckoutTarget,
  formatDueDate,
  invalidField,
  isReturnLink,
  lineErrorField,
  lineUnits,
  parseTokenAmount,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  CreateInvoiceBody,
  ExpiryChoice,
  Invoice,
  InvoiceField,
  InvoiceStart,
  InvoiceToken,
  LineDraft,
  LineError,
  PayWith,
} from "@/features/invoices/types/invoices";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName } from "@/shared/lib/chains";

const INVALID_VALUE = 422;
const DAY_MS = 86_400_000;
type Expiry = ExpiryChoice | typeof CUSTOM_EXPIRY;
const localDate = (time: number) => new Date(time).toLocaleDateString("en-CA");

export interface NewInvoiceFormProps {
  profileId: string;
  tokens: readonly InvoiceToken[];
  request?: { senderName: string; onCreated: (invoice: Invoice) => void };
  // Filled from a closed invoice (R-77): its client, accepted options and amount.
  start?: InvoiceStart;
  /** The profile's saved clients (R-86): picking one fills the client fields with a copy of its details. */
  clients?: readonly Client[];
}

const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };

// One idempotency key per filled-in form: a double click, or a retry of the same values after an error, makes one
// invoice; changed values are a new request with a new key, never a 409. With `request` it is a personal profile's
// request (D-52): amount, note, expiry, return link and the name the payer sees, handed to onCreated instead of
// opening the invoice.
export function NewInvoiceForm({
  profileId,
  tokens,
  request,
  start,
  clients,
}: NewInvoiceFormProps) {
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  const [createInvoice] = useCreateInvoiceMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, { key: string; body: CreateInvoiceBody }>());
  // Payer chooses is the default once there is more than one token to choose from (R-56).
  const [payWith, setPayWith] = useState<PayWith>(start?.payWith ?? PAY_WITH.any);
  const [picked, setPicked] = useState(start?.picked ?? "");
  const [amount, setAmount] = useState(start?.amount ?? "");
  const [expiry, setExpiry] = useState<Expiry>(DEFAULT_EXPIRY);
  const [closesOn, setClosesOn] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [supplyDate, setSupplyDate] = useState<string | null>(null);
  // D-80: who set the checkout's close. The due date sets it until the owner picks one of their own, which then stays.
  const [closeBy, setCloseBy] = useState<"default" | "due" | "owner">("default");
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // R-88: with items the amount is their total; the amount field stands in only while there are none.
  const [items, setItems] = useState<LineDraft[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, LineFieldErrors>>({});
  // Removing the last item puts the amount field back where the items were, with focus.
  const amountId = useId();
  const hadItems = useRef(false);
  useEffect(() => {
    if (hadItems.current && items.length === 0) document.getElementById(amountId)?.focus();
    hadItems.current = items.length > 0;
  }, [items.length, amountId]);
  // The client fields stay uncontrolled like the others; picking a saved client draws them again with its values.
  const [fill, setFill] = useState<{ key: string; client: ClientBody }>({
    key: "",
    client: start?.client ?? NO_CLIENT,
  });
  const [country, setCountry] = useState(fill.client.country);
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), [COPY.noCountry]);
  // The free-text fields stay uncontrolled; the preview reads them as they are typed.
  const [typed, setTyped] = useState({
    title: "",
    note: "",
    client: request?.senderName ?? start?.client.name ?? "",
  });
  const token = tokens.find((t) => tokenKey(t) === picked) ?? tokens[0];
  if (!token) return null;
  const any = payWith === PAY_WITH.any && tokens.length > 1;
  // In USD every token takes the amount, so it can have no more decimals than the token with the fewest.
  const decimals = any ? Math.min(...tokens.map((t) => t.decimals)) : token.decimals;
  const unit = any ? MONEY_COPY.usd : token.symbol;
  const network = chainName(token.chainId);
  const today = localDate(Date.now());
  const amountError = (value: string) => {
    const units = parseTokenAmount(value, decimals);
    if (typeof units !== "string") return undefined;
    const error = COPY.amountErrors[units];
    return typeof error === "function" ? error(unit, decimals) : error;
  };
  const clear = (field: InvoiceField) => setErrors((shown) => ({ ...shown, [field]: undefined }));
  const itemsTotal = items.reduce((sum, item) => {
    const line = lineUnits(item, decimals);
    return typeof line === "string" ? sum : sum + line.units;
  }, 0n);
  const typedUnits = items.length > 0 ? itemsTotal : parseTokenAmount(amount, decimals);
  const lineMessage = (error: LineError) => {
    const message = COPY.items.errors[error];
    return typeof message === "function" ? message(unit, decimals) : message;
  };
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setTyped({
      title: text("title"),
      note: text("note"),
      client: text(request ? "senderName" : "clientName"),
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const showErrors = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors(shown));
      formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    };
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const problems: Record<string, LineFieldErrors> = {};
    const lines = items.map((item) => {
      const line = lineUnits(item, decimals);
      if (typeof line === "string")
        problems[item.id] = { [lineErrorField(line)]: lineMessage(line) };
      return line;
    });
    const units =
      items.length > 0
        ? itemsTotal > 0n
          ? itemsTotal
          : AMOUNT_ERRORS.zero
        : parseTokenAmount(amount, decimals);
    const missingName = request && !text("senderName");
    const expiresIn =
      expiry === CUSTOM_EXPIRY
        ? customExpiresIn(closesOn ?? "", text("closesAt"), Date.now())
        : EXPIRY_CHOICES[expiry];
    const returnUrl = text("returnUrl");
    const badLink = returnUrl !== "" && !isReturnLink(returnUrl);
    const badLines = Object.keys(problems).length > 0;
    flushSync(() => setLineErrors(problems));
    if (typeof units === "string" || badLines || missingName || expiresIn === null || badLink) {
      showErrors({
        [INVOICE_FIELDS.amount]:
          typeof units === "string" && items.length === 0 ? amountError(amount) : undefined,
        [INVOICE_FIELDS.lines]:
          typeof units === "string" && items.length > 0 && !badLines
            ? COPY.items.errors.zero
            : undefined,
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
      supplyDate: text("supplyDate"),
      senderName: text("senderName"),
      returnUrl,
      client: {
        name: text("clientName"),
        email: text("clientEmail"),
        address: text("clientAddress"),
        country,
        taxId: text("clientTaxId"),
      },
      // Unit prices in the amount's own unit: USD with amountUsd, base units with amount.
      ...(items.length > 0
        ? {
            lines: items.map((item, i) => {
              const line = lines[i] as { price: bigint };
              return {
                description: item.description.trim(),
                quantity: item.quantity.trim(),
                unitPrice: any ? decimalText(line.price, decimals) : line.price.toString(),
              };
            }),
          }
        : {}),
    };
    setErrors({});
    setFormError("");
    setBusy(true);
    try {
      // Custom's expiresIn changes every second, and the API refuses a known key with another body.
      const values = JSON.stringify({
        ...body,
        expiresIn: expiry === CUSTOM_EXPIRY ? `${closesOn} ${text("closesAt")}` : body.expiresIn,
      });
      const sent = keys.current.get(values) ?? { key: crypto.randomUUID(), body };
      keys.current.set(values, sent);
      const invoice = await createInvoice({
        profileId,
        idempotencyKey: sent.key,
        body: sent.body,
      }).unwrap();
      if (request) request.onCreated(invoice);
      else router.push(`${APP_ROUTES.invoices}/${invoice.invoiceId}`);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field =
        failure.status === INVALID_VALUE ? invalidField(failure.data?.error?.message ?? "") : null;
      // The amount field shows the API's word on either amount, or the items when they stand in for it.
      const amountField = items.length > 0 ? INVOICE_FIELDS.lines : INVOICE_FIELDS.amount;
      if (field)
        showErrors({
          [field === INVOICE_FIELDS.amountUsd || field === INVOICE_FIELDS.amount
            ? amountField
            : field]: COPY.fieldErrors[field],
        });
      else setFormError(failure.status === INVALID_VALUE ? COPY.invalid : COPY.failed);
      setBusy(false);
    }
  };

  // D-80: a close before the due date plus the grace days would turn a late client's payment into money held for them.
  const closeDay =
    expiry === CUSTOM_EXPIRY ? closesOn : localDate(Date.now() + EXPIRY_CHOICES[expiry] * 1000);
  const dueTarget = dueDate ? dueCheckoutTarget(dueDate) : null;
  const closesEarly = Boolean(dueTarget && closeDay && closeDay < dueTarget);
  const pickDueDate = (iso: string | null) => {
    setDueDate(iso);
    // An empty Custom date has nothing of the owner's to keep, so the due date fills it too.
    if (iso && (closeBy !== "owner" || (expiry === CUSTOM_EXPIRY && !closesOn))) {
      setExpiry(CUSTOM_EXPIRY);
      setClosesOn(dueCheckoutDate(iso, today));
      setCloseBy("due");
      clear(INVOICE_FIELDS.expiresIn);
    } else if (!iso && closeBy === "due") {
      setExpiry(DEFAULT_EXPIRY);
      setClosesOn(null);
      setCloseBy("default");
    }
  };
  const ownClose = () => {
    setCloseBy("owner");
    clear(INVOICE_FIELDS.expiresIn);
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
            ownClose();
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
              ownClose();
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
            onChange={ownClose}
          />
        </div>
      ) : null}
      {/* Always mounted, so a screen reader hears the line when it appears or changes. */}
      <div role="status" className="empty:sr-only">
        {closesEarly && dueTarget ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
            {/* Set by the due date and still short: only the 365-day limit can have cut it. */}
            {closeBy === "due"
              ? COPY.closesAtLimit(formatDueDate(dueTarget))
              : COPY.closesEarly(formatDueDate(dueTarget))}
          </p>
        ) : closeBy === "due" && closesOn ? (
          <p className="text-sm text-muted">{COPY.followsDue(formatDueDate(closesOn))}</p>
        ) : null}
      </div>
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
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 xl:grid-cols-[minmax(0,42rem)_minmax(0,22rem)]">
      <Form onSubmit={submit} onInput={readTyped}>
        <FieldGroup title={COPY.amountGroup}>
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
                  setLineErrors({});
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
              onValueChange={(value) => {
                setPicked(value);
                setLineErrors({});
              }}
              options={tokens.map((t) => ({
                value: tokenKey(t),
                label: `${t.symbol} · ${chainName(t.chainId)}`,
              }))}
            />
          )}
          {items.length > 0 ? (
            <LineItems
              items={items}
              onChange={(next) => {
                if (next.length === 0 && itemsTotal > 0n)
                  setAmount(decimalText(itemsTotal, decimals));
                setItems(next);
                setLineErrors({});
                clear(INVOICE_FIELDS.lines);
              }}
              decimals={decimals}
              unit={unit}
              errors={lineErrors}
              error={errors[INVOICE_FIELDS.lines]}
            />
          ) : (
            <>
              <TextField
                id={amountId}
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
              {request ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setItems([
                      {
                        id: crypto.randomUUID(),
                        description: "",
                        quantity: "1",
                        price: amount.trim(),
                      },
                    ]);
                    clear(INVOICE_FIELDS.amount);
                  }}
                >
                  <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.items.add}
                </Button>
              )}
            </>
          )}
        </FieldGroup>

        <FieldGroup title={COPY.detailsGroup}>
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
        </FieldGroup>

        <FieldGroup title={COPY.datesGroup}>
          {request ? null : (
            <DatePicker
              label={COPY.supplyLabel}
              name="supplyDate"
              value={supplyDate}
              onChange={setSupplyDate}
              clearLabel={COPY.supplyClear}
              hint={COPY.supplyHint}
              error={errors[INVOICE_FIELDS.supplyDate]}
              className="sm:max-w-xs"
            />
          )}
          {request ? null : (
            <DatePicker
              label={COPY.dueLabel}
              name="dueDate"
              value={dueDate}
              onChange={pickDueDate}
              min={today}
              clearLabel={COPY.dueClear}
              hint={COPY.dueHint}
              error={errors[INVOICE_FIELDS.dueDate]}
              className="sm:max-w-xs"
            />
          )}
          {expiryField}
        </FieldGroup>

        {request ? null : (
          <FieldGroup title={COPY.client}>
            {clients?.length ? (
              <ComboboxField
                label={COPY.savedClient}
                placeholder={COPY.savedClientPlaceholder}
                searchLabel={COPY.searchClients}
                options={clients.map((c) => ({
                  value: c.clientId,
                  label: c.name,
                  detail: c.email ?? undefined,
                }))}
                value={fill.key}
                onValueChange={(clientId) => {
                  const picked = clients.find((c) => c.clientId === clientId);
                  if (!picked) return;
                  const values = clientBody(picked);
                  setFill({ key: clientId, client: values });
                  setCountry(values.country);
                  setTyped((shown) => ({ ...shown, client: values.name }));
                  // The client fields are drawn again with new values; errors elsewhere stay.
                  setErrors((shown) => ({
                    ...shown,
                    [INVOICE_FIELDS.clientName]: undefined,
                    [INVOICE_FIELDS.clientEmail]: undefined,
                    [INVOICE_FIELDS.clientAddress]: undefined,
                    [INVOICE_FIELDS.clientCountry]: undefined,
                    [INVOICE_FIELDS.clientTaxId]: undefined,
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
                  maxLength={INVOICE_LIMITS.clientName}
                  error={errors[INVOICE_FIELDS.clientName]}
                />
                <TextField
                  type="email"
                  label={COPY.clientEmail}
                  name="clientEmail"
                  defaultValue={fill.client.email}
                  autoComplete="off"
                  maxLength={INVOICE_LIMITS.clientEmail}
                  error={errors[INVOICE_FIELDS.clientEmail]}
                />
              </div>
              <TextAreaField
                label={COPY.clientAddress}
                name="clientAddress"
                defaultValue={fill.client.address}
                maxLength={INVOICE_LIMITS.clientAddress}
                error={errors[INVOICE_FIELDS.clientAddress]}
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
                    clear(INVOICE_FIELDS.clientCountry);
                  }}
                  error={errors[INVOICE_FIELDS.clientCountry]}
                />
                <TextField
                  label={COPY.clientTaxId}
                  name="clientTaxId"
                  defaultValue={fill.client.taxId}
                  autoComplete="off"
                  maxLength={INVOICE_LIMITS.clientTaxId}
                  error={errors[INVOICE_FIELDS.clientTaxId]}
                />
              </div>
            </div>
          </FieldGroup>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button type="submit" loading={busy}>
            {COPY.create}
          </Button>
          {request ? null : (
            <Link href={APP_ROUTES.invoices} className={buttonClasses({ variant: "ghost" })}>
              {COPY.cancel}
            </Link>
          )}
        </div>
        <p role="alert" className="min-h-5 text-sm text-danger">
          {formError}
        </p>
      </Form>
      <NewInvoicePreview
        copy={COPY.preview}
        units={typeof typedUnits === "string" ? 0n : typedUnits}
        decimals={decimals}
        unit={unit}
        payLine={
          any
            ? COPY.preview.any(
                [...new Set(tokens.map((t) => t.symbol))].join(" or "),
                new Set(tokens.map((t) => t.chainId)).size,
              )
            : COPY.preview.on(network)
        }
        title={typed.title}
        note={typed.note}
        client={typed.client}
        due={dueDate ? formatDueDate(dueDate) : null}
        closes={
          expiry === CUSTOM_EXPIRY
            ? closesOn
              ? formatDueDate(closesOn)
              : COPY.expiry[CUSTOM_EXPIRY]
            : COPY.expiry[expiry]
        }
      />
    </div>
  );
}
