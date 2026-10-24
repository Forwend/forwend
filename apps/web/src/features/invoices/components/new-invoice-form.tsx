"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
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
import { AgreedValueFields } from "@/features/invoices/components/agreed-value";
import { type LineFieldErrors, LineItems } from "@/features/invoices/components/line-items";
import { NewInvoicePreview } from "@/features/invoices/components/new-invoice-preview";
import {
  AMOUNT_ERRORS,
  CUSTOM_EXPIRY,
  EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  PAY_WITH,
} from "@/features/invoices/constants/invoices";
import {
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import {
  agreedDigits,
  customExpiresIn,
  decimalText,
  dueCheckoutDate,
  dueCheckoutTarget,
  expiryChoice,
  formatDueDate,
  invalidField,
  isReturnLink,
  lineErrorField,
  lineUnits,
  offStoreOrigins,
  parseTokenAmount,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  AgreedDraft,
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
import { allowsReturnLink } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName } from "@/shared/lib/chains";

const INVALID_VALUE = 422;
// R-129: the invoice it replaces can no longer be canceled.
const NOT_CANCELABLE = "invoice_not_cancelable";
const DAY_MS = 86_400_000;
type Expiry = ExpiryChoice | typeof CUSTOM_EXPIRY;
const localDate = (time: number) => new Date(time).toLocaleDateString("en-CA");

export interface NewInvoiceFormProps {
  profileId: string;
  tokens: readonly InvoiceToken[];
  request?: { senderName: string; onCreated: (invoice: Invoice) => void };
  // Filled from another invoice (R-91), or with what is left of a closed one (R-77).
  start?: InvoiceStart;
  /** Saved clients (R-86): picking one fills the client fields with a copy. */
  clients?: readonly Client[];
  /** R-129: the invoice this one replaces, canceled when it is created. */
  replaces?: { invoiceId: string; number: string };
  /** A merchant profile's stores (R-134), the first one first; the invoice records one. */
  stores?: readonly Store[];
}

const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };

// One idempotency key per filled-in form: a retry makes one invoice; changed values get a new key.
// With `request` it is a personal profile's request (D-52), handed to onCreated.
export function NewInvoiceForm({
  profileId,
  tokens,
  request,
  start,
  clients,
  replaces,
  stores,
}: NewInvoiceFormProps) {
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  const [createInvoice] = useCreateInvoiceMutation();
  const router = useRouter();
  const keys = useRef(new Map<string, { key: string; body: CreateInvoiceBody }>());
  // Payer chooses is the default once there is more than one token to choose from (R-56).
  const [payWith, setPayWith] = useState<PayWith>(start?.payWith ?? PAY_WITH.any);
  const [picked, setPicked] = useState(start?.picked ?? "");
  const [amount, setAmount] = useState(start?.amount ?? "");
  // A copied invoice keeps its store while the profile still has it.
  const [storeId, setStoreId] = useState(
    stores?.find((s) => s.storeId === start?.storeId)?.storeId ?? stores?.[0]?.storeId ?? "",
  );
  const store = stores?.find((s) => s.storeId === storeId);
  const [expiry, setExpiry] = useState<Expiry>(expiryChoice(store?.defaultExpiresIn));
  const [closesOn, setClosesOn] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [supplyDate, setSupplyDate] = useState<string | null>(null);
  // R-90: a picked client's default replaces the last one filled in, but a reference the owner typed stays.
  const [reference, setReference] = useState(start?.reference ?? "");
  const [agreed, setAgreed] = useState<AgreedDraft | null>(start?.agreed ?? null);
  // R-97: from the picked saved client or the copied invoice.
  const [reminders, setReminders] = useState(start?.reminders ?? false);
  // Repeat every month (R-99), with an optional last due date; a duplicate starts without it.
  const [repeat, setRepeat] = useState(false);
  const [repeatEnd, setRepeatEnd] = useState<string | null>(null);
  const agreedId = useId();
  const remindersId = useId();
  const repeatId = useId();
  const filledReference = useRef("");
  // D-80: who set the checkout's close. The due date sets it until the owner picks one of their own, which then stays.
  const [closeBy, setCloseBy] = useState<"default" | "due" | "owner">("default");
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // R-88: with items the amount is their total; the amount field stands in only while there are none.
  const [items, setItems] = useState<LineDraft[]>(start?.items ?? []);
  const [lineErrors, setLineErrors] = useState<Record<string, LineFieldErrors>>({});
  // The first item added or the last removed swaps the fields, so focus follows; copied items (R-91) take none.
  const amountId = useId();
  const itemsId = useId();
  const hadItems = useRef(items.length > 0);
  useEffect(() => {
    if (hadItems.current && items.length === 0) document.getElementById(amountId)?.focus();
    if (!hadItems.current && items.length > 0)
      document.getElementById(itemsId)?.querySelector("input")?.focus();
    hadItems.current = items.length > 0;
  }, [items.length, amountId, itemsId]);
  // The client fields stay uncontrolled like the others; picking a saved client draws them again with its values.
  const [fill, setFill] = useState<{ key: string; client: ClientBody }>({
    key: "",
    client: start?.client ?? NO_CLIENT,
  });
  const [country, setCountry] = useState(fill.client.country);
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), [COPY.noCountry]);
  // The free-text fields stay uncontrolled; the preview reads them as they are typed.
  const [typed, setTyped] = useState({
    title: start?.title ?? "",
    note: start?.note ?? "",
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
    const badOrigin =
      !badLink && !!store && returnUrl !== "" && !allowsReturnLink(store.allowedOrigins, returnUrl);
    const badLines = Object.keys(problems).length > 0;
    flushSync(() => setLineErrors(problems));
    // R-93.
    const digits = agreed ? agreedDigits(agreed.currency) : undefined;
    const agreedUnits =
      agreed && digits !== undefined ? parseTokenAmount(agreed.amount, digits) : undefined;
    const agreedValue =
      agreed && digits !== undefined && typeof agreedUnits === "bigint" && agreed.date
        ? { currency: agreed.currency, amount: decimalText(agreedUnits, digits), date: agreed.date }
        : undefined;
    const badAgreed = agreed !== null && !agreedValue;
    const badReminders = reminders && (!text("dueDate") || !text("clientEmail"));
    const badRepeat = repeat && (!text("dueDate") || !text("clientEmail"));
    const badRepeatEnd = repeat && !!repeatEnd && repeatEnd < text("dueDate");
    if (
      typeof units === "string" ||
      badLines ||
      badAgreed ||
      badReminders ||
      badRepeat ||
      badRepeatEnd ||
      missingName ||
      expiresIn === null ||
      badLink ||
      badOrigin
    ) {
      showErrors({
        [INVOICE_FIELDS.agreedCurrency]:
          badAgreed && digits === undefined ? COPY.agreed.errors.currency : undefined,
        [INVOICE_FIELDS.agreedAmount]:
          badAgreed && digits !== undefined && typeof agreedUnits === "string"
            ? COPY.agreed.errors.amount(digits)
            : undefined,
        [INVOICE_FIELDS.agreedDate]:
          badAgreed && !agreed?.date ? COPY.agreed.errors.date : undefined,
        [INVOICE_FIELDS.amount]:
          typeof units === "string" && items.length === 0 ? amountError(amount) : undefined,
        [INVOICE_FIELDS.lines]:
          typeof units === "string" && items.length > 0 && !badLines
            ? COPY.items.errors.zero
            : undefined,
        [INVOICE_FIELDS.senderName]: missingName ? NEW_REQUEST_COPY.senderMissing : undefined,
        [INVOICE_FIELDS.expiresIn]: expiresIn === null ? COPY.customError : undefined,
        [INVOICE_FIELDS.returnUrl]: badLink
          ? COPY.returnError
          : badOrigin
            ? NEW_INVOICE_COPY.returnOriginError
            : undefined,
        [INVOICE_FIELDS.reminders]: badReminders
          ? COPY.fieldErrors[INVOICE_FIELDS.reminders]
          : undefined,
        [INVOICE_FIELDS.repeat]: badRepeat ? COPY.fieldErrors[INVOICE_FIELDS.repeat] : undefined,
        [INVOICE_FIELDS.repeatEndDate]: badRepeatEnd
          ? COPY.fieldErrors[INVOICE_FIELDS.repeatEndDate]
          : undefined,
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
      reference: reference.trim(),
      ...(agreedValue ? { agreedValue } : {}),
      ...(reminders ? { reminders: true as const } : {}),
      ...(repeat ? { repeat: repeatEnd ? { endDate: repeatEnd } : {} } : {}),
      ...(replaces ? { replaces: replaces.invoiceId } : {}),
      ...(store ? { storeId: store.storeId } : {}),
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
      const failure = error as {
        status?: unknown;
        data?: { error?: { code?: string; message?: string } };
      };
      const message = failure.data?.error?.message ?? "";
      const field = failure.status === INVALID_VALUE ? invalidField(message) : null;
      const amountField = items.length > 0 ? INVOICE_FIELDS.lines : INVOICE_FIELDS.amount;
      if (field)
        showErrors({
          [field === INVOICE_FIELDS.amountUsd || field === INVOICE_FIELDS.amount
            ? amountField
            : field]: offStoreOrigins(message)
            ? NEW_INVOICE_COPY.returnOriginError
            : COPY.fieldErrors[field],
        });
      else if (replaces && failure.data?.error?.code === NOT_CANCELABLE)
        setFormError(INVOICES_COPY.revise.tooLate(replaces.number));
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
      setExpiry(expiryChoice(store?.defaultExpiresIn));
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
        <div className="grid gap-5 sm:grid-cols-2">
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
      defaultValue={start?.returnUrl}
      inputMode="url"
      autoComplete="url"
      placeholder="https://"
      maxLength={INVOICE_LIMITS.returnUrl}
      hint={
        !store
          ? COPY.returnHint
          : store.allowedOrigins.length > 0
            ? NEW_INVOICE_COPY.returnOrigins(store.allowedOrigins.join(", "))
            : NEW_INVOICE_COPY.returnNoOrigins
      }
      error={errors[INVOICE_FIELDS.returnUrl]}
      onChange={() => clear(INVOICE_FIELDS.returnUrl)}
    />
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
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
          {/* Empty when items stand in for the amount on any token: then the row takes no room. */}
          <div className="grid gap-5 empty:hidden sm:grid-cols-2">
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
            {items.length > 0 ? null : (
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
            )}
          </div>
          {items.length > 0 ? (
            <LineItems
              id={itemsId}
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
          ) : request ? null : (
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
          {request ? null : agreed ? (
            <AgreedValueFields
              id={agreedId}
              value={agreed}
              today={today}
              errors={{
                currency: errors[INVOICE_FIELDS.agreedCurrency],
                amount: errors[INVOICE_FIELDS.agreedAmount],
                date: errors[INVOICE_FIELDS.agreedDate],
              }}
              onChange={(next) => {
                // Remove takes away the button that had focus: it goes back to Add agreed value.
                flushSync(() => setAgreed(next));
                if (!next) document.getElementById(agreedId)?.focus();
                setErrors((shown) => ({
                  ...shown,
                  [INVOICE_FIELDS.agreedCurrency]: undefined,
                  [INVOICE_FIELDS.agreedAmount]: undefined,
                  [INVOICE_FIELDS.agreedDate]: undefined,
                }));
              }}
            />
          ) : (
            <Button
              id={agreedId}
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                // The button goes away: focus moves to the currency it asks for first.
                flushSync(() => setAgreed({ currency: "", amount: "", date: today }));
                document.getElementById(agreedId)?.focus();
              }}
            >
              <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.agreed.add}
            </Button>
          )}
        </FieldGroup>

        <FieldGroup title={COPY.detailsGroup}>
          {stores && stores.length > 1 ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label={NEW_INVOICE_COPY.storeLabel}
                value={storeId}
                onValueChange={(value) => {
                  setStoreId(value);
                  // Its own close, unless a due date or the owner set one.
                  if (closeBy === "default")
                    setExpiry(
                      expiryChoice(stores.find((s) => s.storeId === value)?.defaultExpiresIn),
                    );
                  clear(INVOICE_FIELDS.returnUrl);
                }}
                options={stores.map((s) => ({ value: s.storeId, label: s.name }))}
              />
            </div>
          ) : null}
          <div className="grid gap-5 empty:hidden sm:grid-cols-2">
            {request ? null : (
              <TextField
                label={COPY.titleLabel}
                name="title"
                defaultValue={start?.title}
                maxLength={INVOICE_LIMITS.title}
                placeholder={COPY.titlePlaceholder}
                error={errors[INVOICE_FIELDS.title]}
              />
            )}
            {request ? null : (
              <TextField
                label={COPY.referenceLabel}
                name="reference"
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                  clear(INVOICE_FIELDS.reference);
                }}
                autoComplete="off"
                maxLength={INVOICE_LIMITS.reference}
                hint={COPY.referenceHint}
                error={errors[INVOICE_FIELDS.reference]}
              />
            )}
          </div>
          <TextAreaField
            label={COPY.noteLabel}
            name="note"
            defaultValue={start?.note}
            maxLength={INVOICE_LIMITS.note}
            error={errors[INVOICE_FIELDS.note]}
          />
          {request ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={NEW_REQUEST_COPY.senderLabel}
                name="senderName"
                autoComplete="name"
                defaultValue={request.senderName}
                maxLength={INVOICE_LIMITS.senderName}
                error={errors[INVOICE_FIELDS.senderName]}
              />
              {returnField}
            </div>
          ) : (
            returnField
          )}
        </FieldGroup>

        <FieldGroup title={COPY.datesGroup}>
          <div className="grid gap-5 empty:hidden sm:grid-cols-2">
            {request ? null : (
              <DatePicker
                label={COPY.supplyLabel}
                name="supplyDate"
                value={supplyDate}
                onChange={setSupplyDate}
                clearLabel={COPY.supplyClear}
                hint={COPY.supplyHint}
                error={errors[INVOICE_FIELDS.supplyDate]}
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
              />
            )}
          </div>
          {expiryField}
          {request ? null : (
            <div className="flex flex-col">
              <Checkbox
                label={COPY.remindersLabel}
                checked={reminders}
                onChange={(event) => {
                  setReminders(event.target.checked);
                  clear(INVOICE_FIELDS.reminders);
                }}
                aria-invalid={errors[INVOICE_FIELDS.reminders] ? true : undefined}
                aria-describedby={remindersId}
              />
              <p id={remindersId} className="text-sm text-muted">
                {errors[INVOICE_FIELDS.reminders] ? (
                  <span className="text-danger">{errors[INVOICE_FIELDS.reminders]}</span>
                ) : (
                  COPY.remindersHint
                )}
              </p>
            </div>
          )}
          {request ? null : (
            <div className="flex flex-col">
              <Checkbox
                label={COPY.repeatLabel}
                checked={repeat}
                onChange={(event) => {
                  setRepeat(event.target.checked);
                  clear(INVOICE_FIELDS.repeat);
                  clear(INVOICE_FIELDS.repeatEndDate);
                }}
                aria-invalid={errors[INVOICE_FIELDS.repeat] ? true : undefined}
                aria-describedby={repeatId}
              />
              <p id={repeatId} className="text-sm text-muted">
                {errors[INVOICE_FIELDS.repeat] ? (
                  <span className="text-danger">{errors[INVOICE_FIELDS.repeat]}</span>
                ) : (
                  COPY.repeatHint
                )}
              </p>
            </div>
          )}
          {repeat ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <DatePicker
                label={COPY.repeatEndLabel}
                name="repeatEndDate"
                value={repeatEnd}
                onChange={(iso) => {
                  setRepeatEnd(iso);
                  clear(INVOICE_FIELDS.repeatEndDate);
                }}
                min={dueDate ?? today}
                clearLabel={COPY.repeatEndClear}
                hint={COPY.repeatEndHint}
                error={errors[INVOICE_FIELDS.repeatEndDate]}
              />
            </div>
          ) : null}
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
                  if (reference === "" || reference === filledReference.current) {
                    filledReference.current = picked.reference ?? "";
                    setReference(filledReference.current);
                    clear(INVOICE_FIELDS.reference);
                  }
                  setCountry(values.country);
                  setReminders(picked.reminders);
                  clear(INVOICE_FIELDS.reminders);
                  setTyped((shown) => ({ ...shown, client: values.name }));
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
