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
  IconButton,
  SegmentedControl,
  SelectField,
  Sheet,
  Stepper,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  Mail,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CLIENT_KINDS } from "@/features/clients/constants/clients";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import {
  clientBody,
  clientCountryOptions,
  clientKind,
  clientOptions,
} from "@/features/clients/lib/clients";
import type { Client, ClientBody, ClientKind } from "@/features/clients/types/clients";
import { useCreateInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { AgreedValueFields } from "@/features/invoices/components/agreed-value";
import { FeeSummary } from "@/features/invoices/components/fee-summary";
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
  FEES_FORM_COPY,
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { documentDate } from "@/features/invoices/lib/invoice-document";
import {
  agreedDigits,
  atLeastMinimum,
  customExpiresIn,
  decimalText,
  dueCheckoutDate,
  dueCheckoutTarget,
  expiryChoice,
  feeFigures,
  formatDueDate,
  invalidField,
  isReturnLink,
  lineErrorField,
  lineFigure,
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
  FeeQuote,
  Invoice,
  InvoiceField,
  InvoiceStart,
  InvoiceToken,
  LineDraft,
  LineError,
  PayWith,
} from "@/features/invoices/types/invoices";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import type { FeesPaidBy } from "@/features/profiles/types/profile";
import { allowsReturnLink, returnLinkOrigins } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";
import { AssetIcon } from "@/shared/components/chains/asset-icon";
import { FieldGroup, FlatFieldGroups } from "@/shared/components/field-group";
import {
  SPLIT_FIELDS_CLASSES,
  SPLIT_FORM_CLASSES,
  STEP_HEAD_CLASSES,
} from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { EMAIL_PATTERN } from "@/shared/constants/email";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { ENTER } from "@/shared/constants/motion";
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
  /** Saved clients, searched through the API (R-86, R-177): picking one fills the client fields with a copy. */
  clientSearch?: ClientSearch;
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
  /** Developer mode (D-120): the preview is marked as a testnet invoice. */
  testnet: boolean;
  /** D-122: who pays the fees unless this invoice says otherwise, the profile's choice. */
  feesPaidBy?: FeesPaidBy;
}

const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };
// The step on screen: its groups in a column, fading in from a slight lift each time it shows.
const STEP_SHOWN =
  "flex flex-col gap-8 motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]";
// Folded under More options on Details; one of them in error opens it.
const MORE_FIELDS = [
  INVOICE_FIELDS.returnUrl,
  INVOICE_FIELDS.supplyDate,
  INVOICE_FIELDS.reminders,
  INVOICE_FIELDS.repeat,
  INVOICE_FIELDS.repeatEndDate,
] as const;
// An email is optional; one typed must look like one.
const badEmail = (email: string) => email !== "" && !EMAIL_PATTERN.test(email);

// On a phone the form is the whole screen (the shell's header and tab bar step aside for `data-phone-flow`): no card,
// its own bar on top and its buttons along the bottom. From small screens it is a card beside its preview.
// The form's column is narrower than other step forms': the preview beside it needs room for a readable page.
const SPLIT =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:h-[calc(100dvh-11.5rem)] xl:min-h-[32rem] xl:grid-cols-[minmax(0,35rem)_minmax(0,1fr)] xl:items-stretch";
const CARD = "flex min-w-0 flex-col max-sm:min-h-dvh sm:fw-panel xl:h-full xl:min-h-0";
const FOOTER =
  "sticky bottom-0 z-[1] flex flex-wrap items-center gap-2 border-t border-line bg-surface py-3 max-sm:-mx-4 max-sm:bg-bg max-sm:px-4 max-sm:pb-[calc(.75rem+env(safe-area-inset-bottom,0px))] sm:gap-3 sm:rounded-b-lg sm:px-5 sm:max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]";

// One idempotency key per filled-in form: a retry makes one invoice; changed values get a new key.
// With `request` it is a personal profile's request (D-52), handed to onCreated.
export function NewInvoiceForm({
  profileId,
  tokens: profileTokens,
  request,
  start,
  startClient,
  clientSearch,
  replaces,
  stores,
  issuer,
  testnet,
  feesPaidBy = FEES_PAID_BY.owner,
}: NewInvoiceFormProps) {
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  const [clientPays, setClientPays] = useState(
    (start?.feesPaidBy ?? feesPaidBy) === FEES_PAID_BY.client,
  );
  const [quote, setQuote] = useState<FeeQuote>();
  const [pricing, setPricing] = useState(false);
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
  const moreId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  // D-80: who set the checkout's close. The due date sets it until the owner picks one of their own, which then stays.
  const [closeBy, setCloseBy] = useState<"default" | "due" | "owner">("default");
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Below the two-column width the preview opens over the form, which stays as it was left.
  const [previewOpen, setPreviewOpen] = useState(false);
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
    clientEmail: start?.client.email ?? startClient?.email ?? "",
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
    const units = atLeastMinimum(parseTokenAmount(value, decimals), decimals);
    if (typeof units !== "string") return undefined;
    const error = COPY.amountErrors[units];
    return typeof error === "function" ? error(unit, decimals) : error;
  };
  const clear = (field: InvoiceField) => setErrors((shown) => ({ ...shown, [field]: undefined }));
  const itemsTotal = items.reduce((sum, item) => {
    const line = lineFigure(item, decimals);
    return typeof line === "string" ? sum : sum + line.units;
  }, 0n);
  const typedUnits = items.length > 0 ? itemsTotal : parseTokenAmount(amount, decimals);
  // R-56: what the invoice asks for, the items' total or the typed amount, is at least 1.00; one item may cost less.
  const askedUnits = atLeastMinimum(
    items.length > 0 ? (itemsTotal > 0n ? itemsTotal : AMOUNT_ERRORS.zero) : typedUnits,
    decimals,
  );
  const askedError =
    typeof askedUnits !== "string"
      ? {}
      : items.length > 0
        ? {
            [INVOICE_FIELDS.lines]:
              askedUnits === AMOUNT_ERRORS.min
                ? COPY.items.errors.min(unit)
                : COPY.items.errors.zero,
          }
        : { [INVOICE_FIELDS.amount]: amountError(amount) };
  const lineMessage = (error: LineError) => {
    const message = COPY.items.errors[error];
    return typeof message === "function" ? message(unit, decimals) : message;
  };
  // Opens the step that holds the first error, then focuses it: a field, or an error that has none of its own.
  const toFirstError = (formElement: HTMLFormElement | null | undefined) => {
    const invalid = formElement?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-invalid]',
    );
    const at = invalid?.closest<HTMLElement>("[data-step]")?.dataset.step;
    const index = steps.findIndex((s) => s.id === at);
    if (index >= 0) flushSync(() => setStep(index));
    invalid?.focus();
  };
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setTyped({
      title: text("title"),
      note: text("note"),
      client: text(request ? "senderName" : "clientName"),
      clientEmail: text("clientEmail"),
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
      toFirstError(formElement);
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
    const units = askedUnits;
    const missingName = request && !text("senderName");
    const missingClient = !request && !text("clientName") && !text("clientEmail");
    const wrongEmail = !request && badEmail(text("clientEmail"));
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
      wrongEmail ||
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
        [INVOICE_FIELDS.amount]: askedError[INVOICE_FIELDS.amount],
        [INVOICE_FIELDS.lines]: badLines ? undefined : askedError[INVOICE_FIELDS.lines],
        [INVOICE_FIELDS.clientName]: missingClient ? NEW_INVOICE_COPY.missingClient : undefined,
        [INVOICE_FIELDS.clientEmail]: wrongEmail
          ? COPY.fieldErrors[INVOICE_FIELDS.clientEmail]
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
      feesPaidBy: clientPays ? FEES_PAID_BY.client : FEES_PAID_BY.owner,
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

  const closeChoice = (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The control's own legend names it for screen readers. */}
      <p aria-hidden className="text-sm font-medium text-ink">
        {COPY.expiryLabel}
      </p>
      {/* The small size keeps all five choices beside the due date. */}
      <SegmentedControl
        size="sm"
        label={COPY.expiryLabel}
        value={expiry}
        onValueChange={(value) => {
          setExpiry(value);
          ownClose();
        }}
        className="self-start max-sm:self-stretch"
        options={[...Object.keys(EXPIRY_CHOICES), CUSTOM_EXPIRY].map((value) => ({
          value: value as Expiry,
          label: COPY.expiry[value as Expiry],
        }))}
      />
    </div>
  );
  const expiryMore = (
    <>
      {expiry === CUSTOM_EXPIRY ? (
        <div className={`grid gap-5 sm:grid-cols-2 ${ENTER}`}>
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
      <div role="status" className="empty:hidden">
        {closesEarly && dueTarget ? (
          <p
            className={`flex items-start gap-2.5 rounded-md bg-warning-soft px-3.5 py-2.5 text-sm text-warning ${ENTER}`}
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
            {/* Set by the due date and still short: only the 365-day limit can have cut it. */}
            {closeBy === "due"
              ? COPY.closesAtLimit(formatDueDate(dueTarget))
              : COPY.closesEarly(formatDueDate(dueTarget))}
          </p>
        ) : closeBy === "due" && closesOn ? (
          <p className={`text-sm text-muted ${ENTER}`}>
            {COPY.followsDue(formatDueDate(closesOn))}
          </p>
        ) : null}
      </div>
    </>
  );

  const returnOrigins = store ? returnLinkOrigins(store.allowedOrigins) : [];
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
          : returnOrigins.length > 0
            ? NEW_INVOICE_COPY.returnOrigins(returnOrigins.join(", "))
            : NEW_INVOICE_COPY.returnNoOrigins
      }
      error={errors[INVOICE_FIELDS.returnUrl]}
      onChange={() => clear(INVOICE_FIELDS.returnUrl)}
    />
  );

  const money = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals, fractionDigits: Math.max(2, exactDigits(units, decimals)) })} ${unit}`;
  const total = typeof typedUnits === "string" ? 0n : typedUnits;
  // R-227: when the client pays the fees, the client's documents ask for the price plus them.
  const fees = clientPays ? feeFigures(quote, decimals, true) : null;
  const due = fees && fees.fee > 0n ? money(fees.pays) : money(total);
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
      testnet,
      status: {
        label: COPY.preview.waiting,
        detail: "",
        figure: COPY.preview.amountDue,
        amount: due,
      },
      from: request
        ? sender
          ? { name: sender, lines: [] }
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
        const line = lineFigure(item, decimals);
        return {
          description: item.description.trim() || COPY.preview.noItem,
          quantity: item.quantity.trim() || "—",
          unitPrice: typeof line === "string" ? "—" : money(line.price),
          amount: typeof line === "string" ? "—" : money(line.units),
        };
      }),
      totals:
        fees && fees.fee > 0n
          ? [
              [FEES_FORM_COPY.subtotal, money(total)],
              [FEES_FORM_COPY.networkFee, money(fees.fee)],
              [COPY.preview.total, due],
            ]
          : [[COPY.preview.total, money(total)]],
      note: typed.note,
      pay: any
        ? [COPY.preview.payAny(due), COPY.preview.payPick]
        : [
            COPY.preview.payExact(due, network, token.chainId),
            COPY.preview.payContract(token.symbol, token.token),
          ],
    },
    payer: {
      name: sender,
      amount: due,
      network: any ? COPY.preview.any : COPY.preview.on(network),
    },
    email: {
      subject: sender
        ? COPY.preview.emailSubject(docKind, sender)
        : `${docKind} ${COPY.preview.draft}`,
      lead: COPY.preview.emailLead(sender || COPY.preview.someone, due),
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
    // This step's first error: a field, or the items' own line when no single field is wrong.
    const focusHere = () =>
      formElement
        .querySelector<HTMLElement>(
          `[data-step="${stepId}"] :is([aria-invalid="true"], [data-invalid])`,
        )
        ?.focus();
    const stop = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors((current) => ({ ...current, ...shown })));
      focusHere();
    };
    if (stepId === STEP_IDS.customer && !text("clientName") && !text("clientEmail")) {
      return stop({ [INVOICE_FIELDS.clientName]: NEW_INVOICE_COPY.missingClient });
    }
    if (stepId === STEP_IDS.customer && badEmail(text("clientEmail"))) {
      return stop({ [INVOICE_FIELDS.clientEmail]: COPY.fieldErrors[INVOICE_FIELDS.clientEmail] });
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
        focusHere();
        return;
      }
      if (typeof askedUnits === "string") return stop(askedError);
    }
    if (stepId === STEP_IDS.details && request && !text("senderName")) {
      return stop({ [INVOICE_FIELDS.senderName]: NEW_REQUEST_COPY.senderMissing });
    }
    setStep(step + 1);
    formElement.scrollIntoView?.({ block: "start" });
  };
  const owed = feeFigures(quote, decimals, clientPays);
  const review = [
    ...(request
      ? []
      : [
          {
            step: STEP_IDS.customer,
            term: COPY.client,
            value: [typed.client, typed.clientEmail].filter(Boolean).join(" · "),
          },
        ]),
    items.length > 0
      ? {
          step: STEP_IDS.items,
          term: COPY.review.items,
          value: COPY.review.itemsValue(items.length, money(total)),
        }
      : { step: STEP_IDS.items, term: COPY.items.amount, value: money(total) },
    {
      step: STEP_IDS.items,
      term: COPY.review.clientPays,
      value: (
        <>
          <span className="font-semibold text-ink tabular-nums">{due}</span> {preview.payer.network}
        </>
      ),
    },
    ...(owed
      ? [
          {
            step: STEP_IDS.items,
            term: COPY.review.youReceive,
            value:
              !clientPays && owed.fee > 0n
                ? COPY.review.afterFee(money(owed.receives), money(owed.fee), owed.platform)
                : money(owed.receives),
          },
        ]
      : []),
    {
      step: STEP_IDS.details,
      term: COPY.preview.due,
      value: dueDate ? formatDueDate(dueDate) : COPY.preview.noDue,
    },
    {
      step: STEP_IDS.details,
      term: COPY.review.closes,
      value: expiry === CUSTOM_EXPIRY ? closes : COPY.review.afterCreated(closes),
    },
  ];
  const nextStep = steps[step + 1];
  // An error in a folded field opens the section and keeps it open: fixing the error must not fold it away under
  // the field being typed in. Set during render, so the field is reachable before Create moves focus to it.
  if (!moreOpen && MORE_FIELDS.some((field) => errors[field])) setMoreOpen(true);
  const moreShown = moreOpen;
  const previewPane = <NewInvoicePreview {...preview} />;

  return (
    <div data-phone-flow className={SPLIT}>
      <Form onSubmit={submit} onInput={readTyped} className={SPLIT_FORM_CLASSES}>
        <div className={CARD}>
          {/* Phones: the way out or back, the page's name and how far along it is. */}
          <div className="sticky top-0 z-[2] -mx-4 bg-bg pt-[env(safe-area-inset-top)] sm:hidden">
            <div className="flex items-center gap-1 px-2 py-2">
              {step > 0 ? (
                <IconButton label={COPY.back} onClick={() => setStep(step - 1)}>
                  <ArrowLeft aria-hidden className="size-[var(--fw-icon-md)]" />
                </IconButton>
              ) : (
                <Link
                  href={APP_ROUTES.invoices}
                  aria-label={COPY.cancel}
                  className={`${buttonClasses({ variant: "ghost" })} w-10 px-0!`}
                >
                  <X aria-hidden className="size-[var(--fw-icon-md)]" />
                </Link>
              )}
              <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
                {COPY.title}
              </p>
              <p className="pr-2 text-sm text-muted">{COPY.stepOf(step + 1, steps.length)}</p>
            </div>
            <div
              aria-hidden
              className="grid auto-cols-fr grid-flow-col gap-1.5 border-b border-line px-4 pb-2.5"
            >
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  className={`h-1 rounded-pill transition-colors duration-[var(--fw-duration-base)] ${i <= step ? "bg-ink" : "bg-line"}`}
                />
              ))}
            </div>
          </div>
          <div className={`${STEP_HEAD_CLASSES} max-sm:hidden`}>
            <Stepper label={COPY.stepsLabel} steps={steps} current={step} onStepClick={setStep} />
          </div>
          <div className={`${SPLIT_FIELDS_CLASSES} max-sm:flex-1 max-sm:px-0`}>
            <FlatFieldGroups value>
              {unavailableToken ? (
                <p role="alert" className="text-sm text-danger">
                  The previously selected token is no longer accepted. Choose a token below.
                </p>
              ) : null}
              {request ? null : (
                <div
                  data-step={STEP_IDS.customer}
                  className={stepId === STEP_IDS.customer ? STEP_SHOWN : "hidden"}
                >
                  <FieldGroup title={COPY.client}>
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
                          if (reference === "" || reference === filledReference.current) {
                            filledReference.current = picked.reference ?? "";
                            setReference(filledReference.current);
                            clear(INVOICE_FIELDS.reference);
                          }
                          setCountry(values.country);
                          setKind(clientKind(picked));
                          setReminders(picked.reminders);
                          clear(INVOICE_FIELDS.reminders);
                          setTyped((shown) => ({
                            ...shown,
                            client: values.name,
                            clientEmail: values.email,
                          }));
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
                          onChange={() => clear(INVOICE_FIELDS.clientName)}
                        />
                        <TextField
                          type="email"
                          label={COPY.clientEmail}
                          name="clientEmail"
                          defaultValue={fill.client.email}
                          autoComplete="off"
                          maxLength={INVOICE_LIMITS.clientEmail}
                          error={errors[INVOICE_FIELDS.clientEmail]}
                          onChange={() => {
                            clear(INVOICE_FIELDS.clientEmail);
                            // A name or an email is enough: typing either answers the missing-client error.
                            if (
                              errors[INVOICE_FIELDS.clientName] === NEW_INVOICE_COPY.missingClient
                            )
                              clear(INVOICE_FIELDS.clientName);
                          }}
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
                className={stepId === STEP_IDS.items ? STEP_SHOWN : "hidden"}
              >
                <FieldGroup title={COPY.amountGroup}>
                  <div className="grid gap-5 empty:hidden sm:grid-cols-2">
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
                          className="self-start max-sm:self-stretch"
                          options={Object.values(PAY_WITH).map((value) => ({
                            value,
                            label: COPY.payWith[value],
                          }))}
                        />
                      </div>
                    ) : null}
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
                  </div>
                  {/* One box that reads like the invoice: what is charged, then what the client pays and the
                      owner receives. */}
                  <div className="overflow-hidden rounded-lg border border-line">
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
                    ) : (
                      <div className="flex flex-col gap-2 p-4">
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
                          hint={COPY.minimumHint(unit)}
                          error={errors[INVOICE_FIELDS.amount]}
                        />
                        {request ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-1 self-start"
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
                      </div>
                    )}
                    <div className="border-t border-line">
                      <FeeSummary
                        totals
                        profileId={profileId}
                        storeId={storeId || undefined}
                        any={any}
                        chainId={token.chainId}
                        token={token.token}
                        units={typeof typedUnits === "string" ? 0n : typedUnits}
                        decimals={decimals}
                        clientPays={clientPays}
                        onClientPays={setClientPays}
                        onQuote={setQuote}
                        onPricing={setPricing}
                        money={money}
                      />
                    </div>
                    {request ? null : (
                      <div className="border-t border-line px-4 py-3">
                        {agreed ? (
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
                          <div className="flex flex-col items-start gap-1">
                            <Button
                              id={agreedId}
                              variant="ghost"
                              size="sm"
                              className="-ml-2"
                              onClick={() => {
                                // The button goes away: focus moves to the currency it asks for first.
                                flushSync(() =>
                                  setAgreed({ currency: "", amount: "", date: today }),
                                );
                                document.getElementById(agreedId)?.focus();
                              }}
                            >
                              <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
                              {COPY.agreed.add}
                            </Button>
                            <p className="text-xs text-muted">{COPY.agreed.addHint}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </FieldGroup>
              </div>

              <div
                data-step={STEP_IDS.details}
                className={stepId === STEP_IDS.details ? STEP_SHOWN : "hidden"}
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
                        onChange={() => clear(INVOICE_FIELDS.senderName)}
                      />
                    </div>
                  ) : null}
                </FieldGroup>

                <FieldGroup title={COPY.datesGroup}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {request ? null : (
                      <DatePicker
                        label={COPY.dueLabel}
                        name="dueDate"
                        value={dueDate}
                        onChange={pickDueDate}
                        min={today}
                        clearLabel={COPY.dueClear}
                        error={errors[INVOICE_FIELDS.dueDate]}
                      />
                    )}
                  </div>
                  {closeChoice}
                  {expiryMore}
                  {/* What the template leaves out stays here, folded: it opens itself when one of its fields is wrong. */}
                  <div className="flex flex-col gap-5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={moreShown}
                      aria-controls={moreId}
                      onClick={() => setMoreOpen((open) => !open)}
                      className="-ml-2 self-start"
                    >
                      <ChevronDown
                        aria-hidden
                        className={`size-[var(--fw-icon-sm)] transition-transform duration-[var(--fw-duration-fast)] ${moreShown ? "rotate-180" : ""}`}
                      />
                      {COPY.moreOptions}
                    </Button>
                    {/* Folded, not removed: the form reads every field on Create. */}
                    <div
                      id={moreId}
                      inert={!moreShown}
                      className={`grid transition-[grid-template-rows,opacity] duration-[var(--fw-duration-base)] ease-[var(--fw-ease-out)] ${moreShown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                    >
                      <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
                        {returnField}
                        {request ? null : (
                          <div className="grid gap-5 sm:grid-cols-2">
                            <DatePicker
                              label={COPY.supplyLabel}
                              name="supplyDate"
                              value={supplyDate}
                              onChange={setSupplyDate}
                              clearLabel={COPY.supplyClear}
                              hint={COPY.supplyHint}
                              error={errors[INVOICE_FIELDS.supplyDate]}
                            />
                          </div>
                        )}
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
                                <span className="text-danger">
                                  {errors[INVOICE_FIELDS.reminders]}
                                </span>
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
                      </div>
                    </div>
                  </div>
                </FieldGroup>
              </div>

              {stepId === STEP_IDS.review ? (
                <div className={STEP_SHOWN}>
                  <FieldGroup title={COPY.reviewGroup}>
                    <DetailList className="rounded-md border border-line">
                      {review.map((row) => (
                        <DetailRow key={row.term} term={row.term}>
                          <span className="flex items-baseline justify-end gap-3">
                            <span className="min-w-0 break-words">{row.value || "—"}</span>
                            <Button
                              variant="link"
                              aria-label={COPY.editStep(row.term)}
                              onClick={() => setStep(steps.findIndex((s) => s.id === row.step))}
                              className="shrink-0 text-xs"
                            >
                              {COPY.edit}
                            </Button>
                          </span>
                        </DetailRow>
                      ))}
                    </DetailList>
                    <p className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3.5 py-3 text-sm text-muted">
                      <Mail aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
                      {!request && typed.clientEmail
                        ? COPY.review.afterCreateEmail(typed.clientEmail)
                        : COPY.review.afterCreate}
                    </p>
                  </FieldGroup>
                </div>
              ) : null}
            </FlatFieldGroups>
            <p role="alert" className="text-sm text-danger empty:hidden">
              {formError}
            </p>
          </div>

          <div className={FOOTER}>
            {step > 0 ? (
              <Button
                variant="secondary"
                className="max-sm:hidden"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.back}
              </Button>
            ) : request ? null : (
              <Link
                href={APP_ROUTES.invoices}
                className={`${buttonClasses({ variant: "ghost" })} max-sm:hidden`}
              >
                {COPY.cancel}
              </Link>
            )}
            <p className="flex-1 text-center text-sm text-muted max-sm:hidden">
              {COPY.stepOf(step + 1, steps.length)}
            </p>
            <Button variant="secondary" className="xl:hidden" onClick={() => setPreviewOpen(true)}>
              <Eye aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.preview.title}
            </Button>
            {/* Keys keep these two separate elements: reusing one would turn Continue into a submit mid-click. */}
            {stepId === STEP_IDS.review || !nextStep ? (
              <Button
                key="create"
                type="submit"
                loading={busy}
                disabled={unavailableToken}
                className="max-sm:flex-1"
              >
                {COPY.create}
              </Button>
            ) : (
              <Button
                key="continue"
                // What the client pays and the owner receives wait on the fee quote (R-227).
                disabled={stepId === STEP_IDS.items && pricing}
                className="max-sm:flex-1"
                onClick={(event) => {
                  event.preventDefault();
                  next(event.currentTarget.form);
                }}
              >
                {COPY.continueTo(nextStep.label)}
                <ArrowRight aria-hidden className="size-[var(--fw-icon-sm)]" />
              </Button>
            )}
          </div>
        </div>
      </Form>
      {/* Beside the form from the two-column width; below it, a sheet the Preview button opens. */}
      <aside aria-label={COPY.preview.title} className="min-h-0 max-xl:hidden xl:h-full">
        {previewPane}
      </aside>
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen} title={COPY.preview.title} size="lg">
        <div className="flex flex-col gap-3 pb-5">
          <div className="h-[64dvh]">
            {previewOpen ? <NewInvoicePreview {...preview} inSheet /> : null}
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setPreviewOpen(false)}>
            {COPY.preview.backTo(steps[step]?.label ?? "")}
          </Button>
        </div>
      </Sheet>
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
