"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  ComboboxField,
  DatePicker,
  DetailList,
  DetailRow,
  Form,
  formatTokenAmount,
  SegmentedControl,
  SelectField,
  Stepper,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import { ArrowLeft, ArrowRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CLIENT_KINDS } from "@/features/clients/constants/clients";
import { clientBody, clientCountryOptions, clientKind } from "@/features/clients/lib/clients";
import type { Client, ClientBody, ClientKind } from "@/features/clients/types/clients";
import { useCreateInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { AgreedValueFields } from "@/features/invoices/components/agreed-value";
import { type LineFieldErrors, LineItems } from "@/features/invoices/components/line-items";
import {
  NewInvoicePreview,
  type NewInvoicePreviewProps,
} from "@/features/invoices/components/new-invoice-preview";
import {
  AMOUNT_ERRORS,
  CUSTOM_EXPIRY,
  EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  INVOICE_STEP_IDS,
  PAY_WITH,
  REQUEST_STEPS,
  STEP_IDS,
} from "@/features/invoices/constants/invoices";
import {
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { documentDate } from "@/features/invoices/lib/invoice-document";
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
  tokensOn,
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
import { AssetIcon } from "@/shared/components/chains/asset-icon";
import { FieldGroup, FlatFieldGroups } from "@/shared/components/field-group";
import {
  SPLIT_ASIDE_CLASSES,
  SPLIT_CLASSES,
  SPLIT_FIELDS_CLASSES,
  SPLIT_FORM_CLASSES,
  STEP_CARD_CLASSES,
  STEP_FOOTER_CLASSES,
  STEP_HEAD_CLASSES,
} from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName, TOKEN_SEARCH_FROM } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

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
  /** Started from a client's page: filled as if that saved client was picked. */
  startClient?: Client;
  /** The billing details new invoices copy (R-92), for the preview's From block. */
  issuer?: {
    name: string;
    address: string;
    country: string;
    taxId: string | null;
    email: string;
  } | null;
}

const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };

// One idempotency key per filled-in form: a retry makes one invoice; changed values get a new key.
// With `request` it is a personal profile's request (D-52), handed to onCreated.
export function NewInvoiceForm({
  profileId,
  tokens: profileTokens,
  request,
  start,
  startClient,
  clients,
  replaces,
  stores,
  issuer,
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
  // R-136: the store narrows the profile's tokens.
  const tokens = tokensOn(profileTokens, store?.tokensOff ?? []);
  const [expiry, setExpiry] = useState<Expiry>(expiryChoice(store?.defaultExpiresIn));
  const [closesOn, setClosesOn] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [supplyDate, setSupplyDate] = useState<string | null>(null);
  // R-90: a picked client's default replaces the last one filled in, but a reference the owner typed stays.
  const [reference, setReference] = useState(start?.reference ?? startClient?.reference ?? "");
  const [agreed, setAgreed] = useState<AgreedDraft | null>(start?.agreed ?? null);
  // R-97: from the picked saved client or the copied invoice.
  const [reminders, setReminders] = useState(start?.reminders ?? startClient?.reminders ?? false);
  // Repeat every month (R-99), with an optional last due date; a duplicate starts without it.
  const [repeat, setRepeat] = useState(false);
  const [repeatEnd, setRepeatEnd] = useState<string | null>(null);
  const agreedId = useId();
  const remindersId = useId();
  const repeatId = useId();
  const filledReference = useRef(startClient?.reference ?? "");
  // D-80: who set the checkout's close. The due date sets it until the owner picks one of their own, which then stays.
  const [closeBy, setCloseBy] = useState<"default" | "due" | "owner">("default");
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Below the two-column width the form and its preview take turns; both stay mounted, so nothing typed is lost.
  const [view, setView] = useState<"edit" | "preview">("edit");
  // One group of fields at a time. Every step stays mounted, so going back keeps what was typed, and the final
  // submit still reads every field.
  const steps = (request ? REQUEST_STEPS : INVOICE_STEP_IDS).map((id) => ({
    id,
    label: COPY.stepLabels[id],
  }));
  const [step, setStep] = useState(0);
  const stepId = steps[step]?.id;
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
    key: startClient?.clientId ?? "",
    client: start?.client ?? (startClient ? clientBody(startClient) : NO_CLIENT),
  });
  const [country, setCountry] = useState(fill.client.country);
  const [kind, setKind] = useState<ClientKind>(
    startClient ? clientKind(startClient) : CLIENT_KINDS.business,
  );
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), [COPY.noCountry]);
  // The free-text fields stay uncontrolled; the preview reads them as they are typed.
  const [typed, setTyped] = useState({
    title: start?.title ?? "",
    note: start?.note ?? "",
    client: request?.senderName ?? start?.client.name ?? "",
    clientAddress: start?.client.address ?? startClient?.address ?? "",
    clientTaxId: start?.client.taxId ?? startClient?.taxId ?? "",
  });
  const pickedToken = tokens.find((t) => tokenKey(t) === picked);
  const token = pickedToken ?? tokens[0];
  const unavailableToken = picked !== "" && !pickedToken && payWith === PAY_WITH.fixed;
  if (!token)
    return (
      <div role="alert" className="flex flex-col gap-3 text-sm text-danger">
        <p>
          This store has no accepted tokens available. Check its payment settings before creating an
          invoice.
        </p>
        {stores && stores.length > 1 ? (
          <SelectField
            label={NEW_INVOICE_COPY.storeLabel}
            value={storeId}
            options={stores.map((item) => ({ value: item.storeId, label: item.name }))}
            onValueChange={setStoreId}
          />
        ) : null}
        <Link
          href={APP_ROUTES.networks}
          className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          Check accepted assets
        </Link>
      </div>
    );
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
      clientAddress: text("clientAddress"),
      clientTaxId: text("clientTaxId"),
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unavailableToken) {
      setFormError("Choose an accepted network and token before creating this invoice.");
      return;
    }
    const formElement = event.currentTarget;
    const showErrors = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors(shown));
      const invalid = formElement.querySelector<HTMLElement>('[aria-invalid="true"]');
      const at = invalid?.closest<HTMLElement>("[data-step]")?.dataset.step;
      const index = steps.findIndex((s) => s.id === at);
      if (index >= 0) flushSync(() => setStep(index));
      invalid?.focus();
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
    const missingClient = !request && !text("clientName") && !text("clientEmail");
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
      missingClient ||
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
        [INVOICE_FIELDS.clientName]: missingClient ? NEW_INVOICE_COPY.missingClient : undefined,
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

  const money = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals, fractionDigits: Math.max(2, exactDigits(units, decimals)) })} ${unit}`;
  const total = typeof typedUnits === "string" ? 0n : typedUnits;
  const closes =
    expiry === CUSTOM_EXPIRY ? (closesOn ? formatDueDate(closesOn) : "") : COPY.expiry[expiry];
  const docKind = request ? "Request" : "Invoice";
  const sender = request ? typed.client : (issuer?.name ?? "");
  const preview: NewInvoicePreviewProps = {
    document: {
      label: COPY.preview.title,
      kind: docKind,
      number: COPY.preview.draft,
      reference,
      testnet: true,
      status: {
        label: COPY.preview.waiting,
        detail: dueDate ? COPY.preview.dueOn(documentDate(dueDate)) : COPY.preview.closesIn(closes),
        figure: COPY.preview.amountDue,
        amount: money(total),
      },
      from: request
        ? sender
          ? { name: sender, lines: [COPY.preview.unchecked] }
          : null
        : issuer
          ? {
              name: issuer.name,
              lines: [
                issuer.address,
                issuer.country,
                issuer.taxId ? `Tax ID ${issuer.taxId}` : "",
                issuer.email,
              ],
            }
          : null,
      to:
        request || !typed.client
          ? null
          : {
              name: typed.client,
              lines: [
                typed.clientAddress,
                country,
                typed.clientTaxId ? `Tax ID ${typed.clientTaxId}` : "",
              ],
            },
      facts: [
        [COPY.preview.issued, documentDate(today)],
        [COPY.preview.supply, supplyDate ? documentDate(supplyDate) : ""],
        [COPY.preview.due, dueDate ? documentDate(dueDate) : ""],
        [COPY.preview.closes, closes],
      ],
      title: typed.title,
      lines: items.map((item) => {
        const line = lineUnits(item, decimals);
        return {
          description: item.description.trim() || COPY.preview.noItem,
          quantity: item.quantity.trim() || "—",
          unitPrice: typeof line === "string" ? "—" : money(line.price),
          amount: typeof line === "string" ? "—" : money(line.units),
        };
      }),
      totals: [
        [COPY.preview.total, money(total)],
        [COPY.preview.amountDue, money(total)],
      ],
      note: typed.note,
      pay: any
        ? [COPY.preview.payAny(money(total)), COPY.preview.payPick]
        : [
            COPY.preview.payExact(money(total), network, token.chainId),
            COPY.preview.payContract(token.symbol, token.token),
          ],
    },
    payer: {
      name: sender,
      amount: money(total),
      network: any ? COPY.preview.any : COPY.preview.on(network),
    },
    email: {
      subject: sender
        ? COPY.preview.emailSubject(docKind, sender)
        : `${docKind} ${COPY.preview.draft}`,
      lead: COPY.preview.emailLead(sender || COPY.preview.someone, money(total)),
      details: [
        [docKind, COPY.preview.draft],
        ...(dueDate ? [[COPY.preview.due, formatDueDate(dueDate)] as const] : []),
        [COPY.preview.network, any ? COPY.preview.payerPicks : network],
      ],
    },
  };

  // Continue checks what this step asks for; the last step's submit checks everything again and returns to the
  // step that holds the first error.
  const next = (formElement: HTMLFormElement | null) => {
    if (!formElement) return;
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const stop = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors((current) => ({ ...current, ...shown })));
      formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    };
    if (stepId === STEP_IDS.customer && !text("clientName") && !text("clientEmail")) {
      return stop({ [INVOICE_FIELDS.clientName]: NEW_INVOICE_COPY.missingClient });
    }
    if (stepId === STEP_IDS.items) {
      const problems: Record<string, LineFieldErrors> = {};
      for (const item of items) {
        const line = lineUnits(item, decimals);
        if (typeof line === "string")
          problems[item.id] = { [lineErrorField(line)]: lineMessage(line) };
      }
      flushSync(() => setLineErrors(problems));
      if (Object.keys(problems).length > 0) {
        formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        return;
      }
      if (typeof typedUnits === "string" || typedUnits === 0n) {
        return stop(
          items.length > 0
            ? { [INVOICE_FIELDS.lines]: COPY.items.errors.zero }
            : { [INVOICE_FIELDS.amount]: amountError(amount) },
        );
      }
    }
    if (stepId === STEP_IDS.details && request && !text("senderName")) {
      return stop({ [INVOICE_FIELDS.senderName]: NEW_REQUEST_COPY.senderMissing });
    }
    setStep(step + 1);
    formElement.scrollIntoView?.({ block: "start" });
  };
  const review = [
    ...(request ? [] : [{ step: STEP_IDS.customer, term: COPY.client, value: typed.client }]),
    { step: STEP_IDS.items, term: COPY.amountGroup, value: money(total) },
    { step: STEP_IDS.items, term: COPY.preview.network, value: preview.payer.network },
    {
      step: STEP_IDS.details,
      term: COPY.preview.due,
      value: dueDate ? formatDueDate(dueDate) : COPY.preview.noDue,
    },
    { step: STEP_IDS.details, term: COPY.preview.closes, value: closes },
  ];

  return (
    <div className={SPLIT_CLASSES}>
      <SegmentedControl
        label={COPY.preview.switch}
        value={view}
        onValueChange={(value) => setView(value === "preview" ? "preview" : "edit")}
        options={[
          { value: "edit", label: COPY.preview.edit },
          { value: "preview", label: COPY.preview.title },
        ]}
        className="xl:hidden"
      />
      <Form
        onSubmit={submit}
        onInput={readTyped}
        className={`${SPLIT_FORM_CLASSES} ${view === "preview" ? "max-xl:hidden" : ""}`}
      >
        <div className={STEP_CARD_CLASSES}>
          <div className={STEP_HEAD_CLASSES}>
            <Stepper label={COPY.stepsLabel} steps={steps} current={step} onStepClick={setStep} />
          </div>
          <div className={SPLIT_FIELDS_CLASSES}>
            <FlatFieldGroups value>
              {unavailableToken ? (
                <p role="alert" className="text-sm text-danger">
                  The previously selected token is no longer accepted. Choose a token below.
                </p>
              ) : null}
              {request ? null : (
                <div
                  data-step={STEP_IDS.customer}
                  className={stepId === STEP_IDS.customer ? "contents" : "hidden"}
                >
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
                          setKind(clientKind(picked));
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
                    <div className="flex flex-col gap-1.5">
                      <p aria-hidden className="text-sm font-medium text-ink">
                        {COPY.clientKind}
                      </p>
                      <SegmentedControl
                        label={COPY.clientKind}
                        value={kind}
                        onValueChange={(next) => {
                          setKind(next);
                          clear(INVOICE_FIELDS.clientCountry);
                          clear(INVOICE_FIELDS.clientTaxId);
                        }}
                        className="self-start"
                        options={Object.values(CLIENT_KINDS).map((value) => ({
                          value,
                          label: COPY.clientKinds[value],
                        }))}
                      />
                    </div>
                    <div key={fill.key} className="flex flex-col gap-5">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <TextField
                          label={
                            kind === CLIENT_KINDS.business
                              ? COPY.clientLegalName
                              : COPY.clientPersonName
                          }
                          hint={
                            kind === CLIENT_KINDS.business ? COPY.clientLegalNameHint : undefined
                          }
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
                      {/* A person is billed by name and email; address, country and tax ID are a business's. */}
                      {/* As on the client form: a person has an address and country, but no tax ID. */}
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
                        {kind === CLIENT_KINDS.person ? null : (
                          <TextField
                            label={COPY.clientTaxId}
                            name="clientTaxId"
                            defaultValue={fill.client.taxId}
                            autoComplete="off"
                            maxLength={INVOICE_LIMITS.clientTaxId}
                            error={errors[INVOICE_FIELDS.clientTaxId]}
                          />
                        )}
                      </div>
                    </div>
                  </FieldGroup>
                </div>
              )}

              <div
                data-step={STEP_IDS.items}
                className={stepId === STEP_IDS.items ? "contents" : "hidden"}
              >
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
                      // Past a handful of tokens the picker searches, so "usdc base" finds one among hundreds.
                      <TokenPick
                        label={COPY.tokenLabel}
                        searchLabel={COPY.searchTokens}
                        noResults={COPY.noTokenMatch}
                        value={unavailableToken ? "" : tokenKey(token)}
                        onValueChange={(value) => {
                          setPicked(value);
                          setFormError("");
                          setLineErrors({});
                        }}
                        options={tokens.map((t) => ({
                          value: tokenKey(t),
                          icon: <AssetIcon chainId={t.chainId} symbol={t.symbol} />,
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
                          setErrors((shown) => ({
                            ...shown,
                            [INVOICE_FIELDS.amount]: amountError(amount),
                          }))
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
              </div>

              <div
                data-step={STEP_IDS.details}
                className={stepId === STEP_IDS.details ? "contents" : "hidden"}
              >
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
                              expiryChoice(
                                stores.find((s) => s.storeId === value)?.defaultExpiresIn,
                              ),
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
              </div>

              {stepId === STEP_IDS.review ? (
                <FieldGroup title={COPY.reviewGroup}>
                  <DetailList>
                    {review.map((row) => (
                      <DetailRow key={row.term} term={row.term}>
                        <span className="flex items-center justify-end gap-3">
                          <span className="min-w-0 break-words">{row.value || "—"}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={COPY.editStep(row.term)}
                            onClick={() => setStep(steps.findIndex((s) => s.id === row.step))}
                          >
                            {COPY.edit}
                          </Button>
                        </span>
                      </DetailRow>
                    ))}
                  </DetailList>
                </FieldGroup>
              ) : null}
            </FlatFieldGroups>
            <p role="alert" className="text-sm text-danger empty:hidden">
              {formError}
            </p>
          </div>

          <div className={STEP_FOOTER_CLASSES}>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                <ArrowLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.back}
              </Button>
            ) : request ? null : (
              <Link href={APP_ROUTES.invoices} className={buttonClasses({ variant: "ghost" })}>
                {COPY.cancel}
              </Link>
            )}
            <span className="hidden flex-1 sm:block" />
            {/* Keys keep these two separate elements: reusing one would turn Continue into a submit mid-click. */}
            {stepId === STEP_IDS.review ? (
              <Button key="create" type="submit" loading={busy} disabled={unavailableToken}>
                {COPY.create}
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
        </div>
      </Form>
      {/* Beside the form, scrolling on its own when the pages run longer than the screen. */}
      <aside
        aria-label={COPY.preview.title}
        className={`flex-col xl:flex ${SPLIT_ASIDE_CLASSES} ${view === "preview" ? "flex" : "hidden"}`}
      >
        <NewInvoicePreview {...preview} />
      </aside>
    </div>
  );
}

function TokenPick({
  searchLabel,
  noResults,
  ...props
}: {
  label: string;
  searchLabel: string;
  noResults: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; icon: ReactNode }[];
}) {
  return props.options.length > TOKEN_SEARCH_FROM ? (
    <ComboboxField {...props} searchLabel={searchLabel} noResults={noResults} />
  ) : (
    <SelectField {...props} />
  );
}
