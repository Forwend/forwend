"use client";

import {
  Button,
  buttonClasses,
  ComboboxField,
  DatePicker,
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
import { ArrowLeft, ArrowRight, Eye, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import { clientBody, clientKind } from "@/features/clients/lib/clients";
import type { Client, ClientBody } from "@/features/clients/types/clients";
import { useCreateInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { AgreedValue } from "@/features/invoices/components/agreed-value";
import { CheckoutCloseFields } from "@/features/invoices/components/checkout-close-fields";
import { FeeSummary } from "@/features/invoices/components/fee-summary";
import { type LineFieldErrors, LineItems } from "@/features/invoices/components/line-items";
import { NewInvoiceCustomer } from "@/features/invoices/components/new-invoice-customer";
import { NewInvoiceMoreOptions } from "@/features/invoices/components/new-invoice-more-options";
import { NewInvoicePreview } from "@/features/invoices/components/new-invoice-preview";
import { NewInvoiceReview } from "@/features/invoices/components/new-invoice-review";
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
import { useCheckoutClose } from "@/features/invoices/hooks/use-checkout-close";
import {
  decimalText,
  formatDueDate,
  isReturnLink,
  parseTokenAmount,
  refusedField,
  tokenKey,
  tokensOn,
} from "@/features/invoices/lib/invoices";
import {
  agreedProblems,
  atLeastMinimum,
  customExpiresIn,
  feeFigures,
  lineErrorField,
  lineFigure,
  lineUnits,
  newInvoicePreview,
} from "@/features/invoices/lib/new-invoice";
import type {
  AgreedDraft,
  CreateInvoiceBody,
  FeeQuote,
  InvoiceField,
  InvoiceIssuer,
  InvoiceStart,
  InvoiceToken,
  LineDraft,
  PayWith,
} from "@/features/invoices/types/invoices";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import type { FeesPaidBy } from "@/features/profiles/types/profile";
import { allowsReturnLink } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";
import { AssetIcon } from "@/shared/components/chains/asset-icon";
import { FieldGroup, FlatFieldGroups } from "@/shared/components/field-group";
import {
  SPLIT_FIELDS_CLASSES,
  SPLIT_FORM_CLASSES,
  STEP_HEAD_CLASSES,
  useFormSteps,
} from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { EMAIL_PATTERN } from "@/shared/constants/email";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName, TOKEN_SEARCH_FROM } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const INVALID_VALUE = 422;
// The invoice it replaces can no longer be canceled.
const NOT_CANCELABLE = "invoice_not_cancelable";
const NO_CLIENT: ClientBody = { name: "", email: "", address: "", country: "", taxId: "" };
const MORE_FIELDS = [
  INVOICE_FIELDS.returnUrl,
  INVOICE_FIELDS.supplyDate,
  INVOICE_FIELDS.reminders,
  INVOICE_FIELDS.repeat,
  INVOICE_FIELDS.repeatEndDate,
] as const;
const STEP_SHOWN =
  "flex flex-col gap-8 motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]";

// Phones: the whole screen (the shell steps aside for data-phone-flow); larger: a card beside the preview.
const SPLIT =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:h-[calc(100dvh-11.5rem)] xl:min-h-[32rem] xl:grid-cols-[minmax(0,35rem)_minmax(0,1fr)] xl:items-stretch";
const CARD = "flex min-w-0 flex-col max-sm:min-h-dvh sm:fw-panel xl:h-full xl:min-h-0";
const FOOTER =
  "sticky bottom-0 z-[1] flex flex-wrap items-center gap-2 border-t border-line bg-surface py-3 max-sm:-mx-4 max-sm:bg-bg max-sm:px-4 max-sm:pb-[calc(.75rem+env(safe-area-inset-bottom,0px))] sm:gap-3 sm:rounded-b-lg sm:px-5 sm:max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]";

const badEmail = (email: string) => email !== "" && !EMAIL_PATTERN.test(email);
const textOf = (form: HTMLFormElement) => {
  const data = new FormData(form);
  return (name: string) => String(data.get(name) ?? "").trim();
};

export interface NewInvoiceFormProps {
  profileId: string;
  tokens: readonly InvoiceToken[];
  request?: { senderName: string }; // a personal profile's request
  start?: InvoiceStart; // filled from another invoice
  clientSearch?: ClientSearch;
  replaces?: { invoiceId: string; number: string }; // canceled when this one is created
  stores?: readonly Store[];
  startClient?: Client;
  issuer?: InvoiceIssuer | null;
  testnet: boolean;
  feesPaidBy?: FeesPaidBy; // the profile's choice
}

// One idempotency key per filled-in form: a retry makes one invoice; changed values get a new key.
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
  const router = useRouter();
  const [createInvoice] = useCreateInvoiceMutation();
  const keys = useRef(new Map<string, { key: string; body: CreateInvoiceBody }>());
  const [clientPays, setClientPays] = useState(
    (start?.feesPaidBy ?? feesPaidBy) === FEES_PAID_BY.client,
  );
  const [quote, setQuote] = useState<FeeQuote>();
  const [pricing, setPricing] = useState(false);
  // Payer chooses is the default once there is more than one token to choose from.
  const [payWith, setPayWith] = useState<PayWith>(start?.payWith ?? PAY_WITH.any);
  const [picked, setPicked] = useState(start?.picked ?? "");
  const [amount, setAmount] = useState(start?.amount ?? "");
  // A copied invoice keeps its store while the profile still has it.
  const [storeId, setStoreId] = useState(
    stores?.find((s) => s.storeId === start?.storeId)?.storeId ?? stores?.[0]?.storeId ?? "",
  );
  const store = stores?.find((s) => s.storeId === storeId);
  const tokens = tokensOn(profileTokens, store?.tokensOff ?? []);
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const clear = (field: InvoiceField) => setErrors((shown) => ({ ...shown, [field]: undefined }));
  const close = useCheckoutClose(store?.defaultExpiresIn, () => clear(INVOICE_FIELDS.expiresIn));
  const today = close.today;
  const [supplyDate, setSupplyDate] = useState<string | null>(null);
  // A picked client's reference replaces the last one filled in, but one the owner typed stays.
  const [reference, setReference] = useState(start?.reference ?? startClient?.reference ?? "");
  const filledReference = useRef(startClient?.reference ?? "");
  const [agreed, setAgreed] = useState<AgreedDraft | null>(start?.agreed ?? null);
  const [reminders, setReminders] = useState(start?.reminders ?? startClient?.reminders ?? false);
  const [repeat, setRepeat] = useState(false);
  const [repeatEnd, setRepeatEnd] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Every step stays mounted, so going back keeps what was typed and submit reads every field.
  const flow = useFormSteps(
    (request ? REQUEST_STEPS : INVOICE_STEP_IDS).map((id) => ({ id, label: COPY.stepLabels[id] })),
  );
  const { steps, step, setStep, at: stepId } = flow;
  const [items, setItems] = useState<LineDraft[]>(start?.items ?? []);
  const [lineErrors, setLineErrors] = useState<Record<string, LineFieldErrors>>({});
  // Adding the first item or removing the last swaps the fields, so focus follows.
  const amountId = useId();
  const itemsId = useId();
  const hadItems = useRef(items.length > 0);
  useEffect(() => {
    if (hadItems.current && items.length === 0) document.getElementById(amountId)?.focus();
    if (!hadItems.current && items.length > 0)
      document.getElementById(itemsId)?.querySelector("input")?.focus();
    hadItems.current = items.length > 0;
  }, [items.length, amountId, itemsId]);
  // Uncontrolled fields: a new key draws them again with the picked client's values.
  const [fill, setFill] = useState<{ key: string; client: ClientBody }>({
    key: startClient?.clientId ?? "",
    client: start?.client ?? (startClient ? clientBody(startClient) : NO_CLIENT),
  });
  const [country, setCountry] = useState(fill.client.country);
  const [kind, setKind] = useState(clientKind(startClient));
  const [moreOpen, setMoreOpen] = useState(false);
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
        <p>{NEW_INVOICE_COPY.storeNoTokens}</p>
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
          {NEW_INVOICE_COPY.checkAssets}
        </Link>
      </div>
    );
  const any = payWith === PAY_WITH.any && tokens.length > 1;
  // In USD every token takes the amount, so it can have no more decimals than the token with the fewest.
  const decimals = any ? Math.min(...tokens.map((t) => t.decimals)) : token.decimals;
  const unit = any ? MONEY_COPY.usd : token.symbol;
  const money = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals, fractionDigits: Math.max(2, exactDigits(units, decimals)) })} ${unit}`;
  const amountError = (value: string) => {
    const units = atLeastMinimum(parseTokenAmount(value, decimals), decimals);
    if (typeof units !== "string") return undefined;
    const error = COPY.amountErrors[units];
    return typeof error === "function" ? error(unit, decimals) : error;
  };
  const itemsTotal = items.reduce((sum, item) => {
    const line = lineFigure(item, decimals);
    return typeof line === "string" ? sum : sum + line.units;
  }, 0n);
  const typedUnits = items.length > 0 ? itemsTotal : parseTokenAmount(amount, decimals);
  const total = typeof typedUnits === "string" ? 0n : typedUnits;
  // One item may cost less than 1.00, but what the invoice asks for may not.
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
  // Shows each item's first problem; true when there is none.
  const checkLines = () => {
    const problems: Record<string, LineFieldErrors> = {};
    for (const item of items) {
      const line = lineUnits(item, decimals);
      if (typeof line !== "string") continue;
      const message = COPY.items.errors[line];
      problems[item.id] = {
        [lineErrorField(line)]: typeof message === "function" ? message(unit, decimals) : message,
      };
    }
    flushSync(() => setLineErrors(problems));
    return Object.keys(problems).length === 0;
  };
  // A name or an email is enough.
  const customerError = (text: (name: string) => string) =>
    !text("clientName") && !text("clientEmail")
      ? { [INVOICE_FIELDS.clientName]: NEW_INVOICE_COPY.missingClient }
      : badEmail(text("clientEmail"))
        ? { [INVOICE_FIELDS.clientEmail]: COPY.fieldErrors[INVOICE_FIELDS.clientEmail] }
        : null;
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const text = textOf(event.currentTarget);
    setTyped({
      title: text("title"),
      note: text("note"),
      client: text(request ? "senderName" : "clientName"),
      clientEmail: text("clientEmail"),
      clientAddress: text("clientAddress"),
      clientTaxId: text("clientTaxId"),
    });
  };
  const pickClient = (client: Client) => {
    const values = clientBody(client);
    setFill({ key: client.clientId, client: values });
    if (reference === "" || reference === filledReference.current) {
      filledReference.current = client.reference ?? "";
      setReference(filledReference.current);
      clear(INVOICE_FIELDS.reference);
    }
    setCountry(values.country);
    setKind(clientKind(client));
    setReminders(client.reminders);
    clear(INVOICE_FIELDS.reminders);
    setTyped((shown) => ({ ...shown, client: values.name, clientEmail: values.email }));
    setErrors((shown) => ({
      ...shown,
      [INVOICE_FIELDS.clientName]: undefined,
      [INVOICE_FIELDS.clientEmail]: undefined,
      [INVOICE_FIELDS.clientAddress]: undefined,
      [INVOICE_FIELDS.clientCountry]: undefined,
      [INVOICE_FIELDS.clientTaxId]: undefined,
    }));
  };

  // Continue checks this step; submit checks every step and opens the one with the first error.
  const next = (formElement: HTMLFormElement | null) => {
    if (!formElement) return;
    const text = textOf(formElement);
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
    if (stepId === STEP_IDS.customer) {
      const shown = customerError(text);
      if (shown) return stop(shown);
    }
    if (stepId === STEP_IDS.items) {
      if (!checkLines()) return focusHere();
      if (typeof askedUnits === "string") return stop(askedError);
    }
    if (stepId === STEP_IDS.details && request && !text("senderName")) {
      return stop({ [INVOICE_FIELDS.senderName]: NEW_REQUEST_COPY.senderMissing });
    }
    setStep(step + 1);
    formElement.scrollIntoView?.({ block: "start" });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unavailableToken) {
      setFormError(NEW_INVOICE_COPY.chooseToken);
      return;
    }
    const formElement = event.currentTarget;
    const showErrors = (shown: Partial<Record<InvoiceField, string>>) => {
      flushSync(() => setErrors(shown));
      flow.focusError(formElement);
    };
    const text = textOf(formElement);
    const linesOk = checkLines();
    const missingName = request && !text("senderName");
    const customer = request ? null : customerError(text);
    const expiresIn =
      close.expiry === CUSTOM_EXPIRY
        ? customExpiresIn(close.closesOn ?? "", text("closesAt"), Date.now())
        : EXPIRY_CHOICES[close.expiry];
    const returnUrl = text("returnUrl");
    const badLink = returnUrl !== "" && !isReturnLink(returnUrl);
    const badOrigin =
      !badLink && !!store && returnUrl !== "" && !allowsReturnLink(store.allowedOrigins, returnUrl);
    const agreedCheck = agreed ? agreedProblems(agreed) : null;
    const dueAndEmail = Boolean(text("dueDate") && text("clientEmail"));
    const badReminders = reminders && !dueAndEmail;
    const badRepeat = repeat && !dueAndEmail;
    const badRepeatEnd = repeat && !!repeatEnd && repeatEnd < text("dueDate");
    if (
      typeof askedUnits === "string" ||
      !linesOk ||
      (agreedCheck && !agreedCheck.value) ||
      badReminders ||
      badRepeat ||
      badRepeatEnd ||
      missingName ||
      customer ||
      expiresIn === null ||
      badLink ||
      badOrigin
    ) {
      showErrors({
        [INVOICE_FIELDS.agreedCurrency]: agreedCheck?.currency
          ? COPY.agreed.errors.currency
          : undefined,
        [INVOICE_FIELDS.agreedAmount]:
          agreedCheck?.amount !== undefined
            ? COPY.agreed.errors.amount(agreedCheck.amount)
            : undefined,
        [INVOICE_FIELDS.agreedDate]: agreedCheck?.date ? COPY.agreed.errors.date : undefined,
        [INVOICE_FIELDS.amount]: askedError[INVOICE_FIELDS.amount],
        [INVOICE_FIELDS.lines]: linesOk ? askedError[INVOICE_FIELDS.lines] : undefined,
        ...customer,
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
        ? { amountUsd: decimalText(askedUnits, decimals) }
        : { chainId: token.chainId, token: token.token, amount: askedUnits.toString() }),
      expiresIn,
      title: text("title"),
      note: text("note"),
      dueDate: text("dueDate"),
      supplyDate: text("supplyDate"),
      reference: reference.trim(),
      ...(agreedCheck?.value ? { agreedValue: agreedCheck.value } : {}),
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
            lines: items.map((item) => {
              const { price } = lineUnits(item, decimals) as { price: bigint };
              return {
                description: item.description.trim(),
                quantity: item.quantity.trim(),
                unitPrice: any ? decimalText(price, decimals) : price.toString(),
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
        expiresIn:
          close.expiry === CUSTOM_EXPIRY ? `${close.closesOn} ${text("closesAt")}` : body.expiresIn,
      });
      const sent = keys.current.get(values) ?? { key: crypto.randomUUID(), body };
      keys.current.set(values, sent);
      const invoice = await createInvoice({
        profileId,
        idempotencyKey: sent.key,
        body: sent.body,
      }).unwrap();
      router.push(`${APP_ROUTES.invoices}/${invoice.invoiceId}`);
    } catch (error) {
      const failure = error as {
        status?: unknown;
        data?: { error?: { code?: string; message?: string } };
      };
      const refused =
        failure.status === INVALID_VALUE ? refusedField(failure.data?.error?.message ?? "") : null;
      if (refused) {
        const amountField = items.length > 0 ? INVOICE_FIELDS.lines : INVOICE_FIELDS.amount;
        showErrors({
          [refused.field === INVOICE_FIELDS.amountUsd || refused.field === INVOICE_FIELDS.amount
            ? amountField
            : refused.field]: refused.message,
        });
      } else if (replaces && failure.data?.error?.code === NOT_CANCELABLE)
        setFormError(INVOICES_COPY.revise.tooLate(replaces.number));
      else setFormError(failure.status === INVALID_VALUE ? COPY.invalid : COPY.failed);
      setBusy(false);
    }
  };

  // When the client pays the fees, the client's documents ask for the price plus them.
  const clientFees = clientPays ? feeFigures(quote, decimals, true) : null;
  const clientFee = clientFees && clientFees.fee > 0n ? clientFees.fee : 0n;
  const due = clientFees && clientFee > 0n ? money(clientFees.pays) : money(total);
  const preview = newInvoicePreview({
    request: Boolean(request),
    testnet,
    issuer,
    typed,
    country,
    reference,
    today,
    supplyDate,
    dueDate: close.dueDate,
    closes: close.closes,
    items,
    decimals,
    money,
    total,
    clientFee,
    due,
    token: any ? null : token,
  });
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
      value: close.dueDate ? formatDueDate(close.dueDate) : COPY.preview.noDue,
    },
    {
      step: STEP_IDS.details,
      term: COPY.review.closes,
      value: close.expiry === CUSTOM_EXPIRY ? close.closes : COPY.review.afterCreated(close.closes),
    },
  ];
  const nextStep = steps[step + 1];
  // An error in a folded field opens More options, set during render so Create can focus the field.
  if (!moreOpen && MORE_FIELDS.some((field) => errors[field])) setMoreOpen(true);

  return (
    <div data-phone-flow className={SPLIT}>
      <Form onSubmit={submit} onInput={readTyped} className={SPLIT_FORM_CLASSES}>
        <div className={CARD}>
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
                  {NEW_INVOICE_COPY.tokenGone}
                </p>
              ) : null}
              {request ? null : (
                <div
                  data-step={STEP_IDS.customer}
                  className={stepId === STEP_IDS.customer ? STEP_SHOWN : "hidden"}
                >
                  <NewInvoiceCustomer
                    clientSearch={clientSearch}
                    fill={fill}
                    kind={kind}
                    onKind={setKind}
                    country={country}
                    onCountry={setCountry}
                    onPick={pickClient}
                    errors={errors}
                    clear={clear}
                  />
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
                        units={total}
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
                        <AgreedValue
                          value={agreed}
                          today={today}
                          errors={{
                            currency: errors[INVOICE_FIELDS.agreedCurrency],
                            amount: errors[INVOICE_FIELDS.agreedAmount],
                            date: errors[INVOICE_FIELDS.agreedDate],
                          }}
                          onChange={(next) => {
                            setAgreed(next);
                            setErrors((shown) => ({
                              ...shown,
                              [INVOICE_FIELDS.agreedCurrency]: undefined,
                              [INVOICE_FIELDS.agreedAmount]: undefined,
                              [INVOICE_FIELDS.agreedDate]: undefined,
                            }));
                          }}
                        />
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
                          close.pickDefault(
                            stores.find((s) => s.storeId === value)?.defaultExpiresIn,
                          );
                          clear(INVOICE_FIELDS.returnUrl);
                        }}
                        options={stores.map((s) => ({ value: s.storeId, label: s.name }))}
                      />
                    </div>
                  ) : null}
                  <div className="grid gap-5 empty:hidden sm:grid-cols-2">
                    {request ? null : (
                      <>
                        <TextField
                          label={COPY.titleLabel}
                          name="title"
                          defaultValue={start?.title}
                          maxLength={INVOICE_LIMITS.title}
                          placeholder={COPY.titlePlaceholder}
                          error={errors[INVOICE_FIELDS.title]}
                        />
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
                      </>
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
                        value={close.dueDate}
                        onChange={close.pickDueDate}
                        min={today}
                        clearLabel={COPY.dueClear}
                        error={errors[INVOICE_FIELDS.dueDate]}
                      />
                    )}
                  </div>
                  <CheckoutCloseFields close={close} error={errors[INVOICE_FIELDS.expiresIn]} />
                  <NewInvoiceMoreOptions
                    open={moreOpen}
                    onToggle={() => setMoreOpen((open) => !open)}
                    request={Boolean(request)}
                    store={store}
                    returnUrl={start?.returnUrl}
                    supplyDate={supplyDate}
                    onSupplyDate={setSupplyDate}
                    reminders={reminders}
                    onReminders={setReminders}
                    repeat={repeat}
                    onRepeat={setRepeat}
                    repeatEnd={repeatEnd}
                    onRepeatEnd={setRepeatEnd}
                    repeatEndMin={close.dueDate ?? today}
                    errors={errors}
                    clear={clear}
                  />
                </FieldGroup>
              </div>

              {stepId === STEP_IDS.review ? (
                <div className={STEP_SHOWN}>
                  <NewInvoiceReview
                    rows={review}
                    next={
                      !request && typed.clientEmail
                        ? COPY.review.afterCreateEmail(typed.clientEmail)
                        : COPY.review.afterCreate
                    }
                    onEdit={(id) => setStep(steps.findIndex((s) => s.id === id))}
                  />
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
                // What the client pays and the owner receives wait on the fee quote.
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
      <aside aria-label={COPY.preview.title} className="min-h-0 max-xl:hidden xl:h-full">
        <NewInvoicePreview {...preview} />
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

// Past a handful of tokens the picker searches, so "usdc base" finds one among hundreds.
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
