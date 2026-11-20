import type { NewInvoicePreviewProps } from "@/features/invoices/components/new-invoice-preview";
import {
  AGREED_CURRENCIES,
  DEFAULT_EXPIRY,
  DUE_GRACE_DAYS,
  EXPIRY_BOUNDS_S,
  EXPIRY_CHOICES,
  LINE_ERRORS,
  LINE_LIMITS,
} from "@/features/invoices/constants/invoices";
import {
  FEES_FORM_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { documentDate } from "@/features/invoices/lib/invoice-document";
import { decimalText } from "@/features/invoices/lib/invoices";
import type {
  AgreedDraft,
  ExpiryChoice,
  FeeQuote,
  InvoiceIssuer,
  InvoiceToken,
  LineDraft,
  LineError,
  LineField,
} from "@/features/invoices/types/invoices";
import { AMOUNT_ERRORS } from "@/shared/constants/money";
import { chainName } from "@/shared/lib/chains";
import { formatDueDate } from "@/shared/lib/dates";
import { parseTokenAmount } from "@/shared/lib/money";
import type { AmountError } from "@/shared/types/money";

const DAY_MS = 86_400_000;

/** At least 1.00 USD: one whole stablecoin. */
export function atLeastMinimum(
  units: bigint | AmountError,
  decimals: number,
): bigint | AmountError {
  return typeof units === "bigint" && units < 10n ** BigInt(decimals) ? AMOUNT_ERRORS.min : units;
}

/** Quantity has 2 decimals, so the total must be whole base units; a price of 0 is free. */
export function lineUnits(
  line: Pick<LineDraft, "description" | "quantity" | "price">,
  decimals: number,
): { price: bigint; units: bigint } | LineError {
  const description = line.description.trim();
  if (!description || description.length > LINE_LIMITS.description) return LINE_ERRORS.description;
  const quantity = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(line.quantity.trim());
  const hundredths = quantity ? BigInt(`${quantity[1]}${(quantity[2] ?? "").padEnd(2, "0")}`) : 0n;
  if (hundredths === 0n || hundredths > BigInt(LINE_LIMITS.quantityMax) * 100n)
    return LINE_ERRORS.quantity;
  const price = parseTokenAmount(line.price, decimals);
  if (typeof price === "string" && price !== AMOUNT_ERRORS.zero) return LINE_ERRORS.price;
  const units = typeof price === "string" ? 0n : price;
  if ((units * hundredths) % 100n !== 0n) return LINE_ERRORS.exact;
  return { price: units, units: (units * hundredths) / 100n };
}

/** A row's figure as typed: its price counts before its description is written. */
export function lineFigure(
  line: Pick<LineDraft, "description" | "quantity" | "price">,
  decimals: number,
): ReturnType<typeof lineUnits> {
  return lineUnits({ ...line, description: line.description.trim() || "-" }, decimals);
}

export function lineErrorField(error: LineError): LineField {
  return error === LINE_ERRORS.exact ? LINE_ERRORS.price : error;
}

/** What an agreed value lacks before the API takes it; value is set when nothing does. */
export function agreedProblems(agreed: AgreedDraft): {
  value?: { currency: string; amount: string; date: string };
  currency?: true;
  amount?: number; // the currency's decimals
  date?: true;
} {
  const digits = (AGREED_CURRENCIES as Record<string, number>)[agreed.currency];
  const units = digits === undefined ? undefined : parseTokenAmount(agreed.amount, digits);
  if (digits !== undefined && typeof units === "bigint" && agreed.date)
    return {
      value: { currency: agreed.currency, amount: decimalText(units, digits), date: agreed.date },
    };
  return {
    ...(digits === undefined ? { currency: true as const } : {}),
    ...(digits !== undefined && typeof units === "string" ? { amount: digits } : {}),
    ...(agreed.date ? {} : { date: true as const }),
  };
}

/** Null when either is missing or the result is outside the API's 15 minutes to 365 days. */
export function customExpiresIn(date: string, time: string, now: number): number | null {
  const at = Date.parse(`${date}T${time}`);
  if (!date || !time || Number.isNaN(at)) return null;
  const seconds = Math.round((at - now) / 1000);
  return seconds >= EXPIRY_BOUNDS_S.min && seconds <= EXPIRY_BOUNDS_S.max ? seconds : null;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The due date plus the grace days, so a client who pays late still pays. */
export function dueCheckoutTarget(dueDate: string): string {
  return addDays(dueDate, DUE_GRACE_DAYS);
}

/** Capped at the day before the 365th, so the close time on it stays within 365 days. */
export function dueCheckoutDate(dueDate: string, today: string): string {
  const target = dueCheckoutTarget(dueDate);
  const latest = addDays(today, EXPIRY_BOUNDS_S.max / EXPIRY_CHOICES.day - 1);
  // biome-ignore lint/complexity/useMathMinMax: ISO date strings; Math.min would give NaN
  return target < latest ? target : latest;
}

/** The choice matching a store's default close; New invoice's default otherwise. */
export function expiryChoice(seconds: number | undefined): ExpiryChoice {
  const choices = Object.entries(EXPIRY_CHOICES) as [ExpiryChoice, number][];
  return choices.find(([, value]) => value === seconds)?.[0] ?? DEFAULT_EXPIRY;
}

/** Every option carries the highest network's fees, so one figure covers any network. */
export function feeFigures(
  quote: FeeQuote | undefined,
  decimals: number,
  clientPays: boolean,
): {
  fee: bigint;
  pays: bigint;
  receives: bigint;
  platform: boolean; // a platform fee is part of fee
} | null {
  const option = quote?.options.find((o) => o.decimals === decimals);
  if (!option) return null;
  const fee = BigInt(option.networkFee) + BigInt(option.platformFee);
  const price = BigInt(option.price);
  return {
    fee,
    pays: clientPays ? price + fee : price,
    receives: clientPays ? price : price - fee,
    platform: BigInt(option.platformFee) > 0n,
  };
}

interface NewInvoiceDraft {
  request: boolean;
  testnet: boolean;
  issuer: InvoiceIssuer | null | undefined;
  typed: {
    title: string;
    note: string;
    client: string; // a request's sender name
    clientAddress: string;
    clientTaxId: string;
  };
  country: string;
  reference: string;
  today: string;
  supplyDate: string | null;
  dueDate: string | null;
  closes: string;
  items: readonly LineDraft[];
  decimals: number;
  money: (units: bigint) => string;
  total: bigint; // base units
  clientFee: bigint; // 0 when the owner pays the fees
  due: string;
  token: InvoiceToken | null; // null when the client chooses
}

/** The invoice, the pay page and the email as the client will see them. */
export function newInvoicePreview(draft: NewInvoiceDraft): NewInvoicePreviewProps {
  const { request, issuer, typed, money, due, token } = draft;
  const COPY = (request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY).preview;
  const sender = request ? typed.client : (issuer?.name ?? "");
  const network = token ? chainName(token.chainId) : "";
  return {
    document: {
      label: COPY.title,
      kind: COPY.kind,
      number: COPY.draft,
      reference: draft.reference,
      testnet: draft.testnet,
      status: { label: COPY.waiting, detail: "", figure: COPY.amountDue, amount: due },
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
                issuer.taxId ? COPY.taxId(issuer.taxId) : "",
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
                draft.country,
                typed.clientTaxId ? COPY.taxId(typed.clientTaxId) : "",
              ],
            },
      facts: [
        [COPY.issued, documentDate(draft.today)],
        [COPY.supply, draft.supplyDate ? documentDate(draft.supplyDate) : ""],
        [COPY.due, draft.dueDate ? documentDate(draft.dueDate) : ""],
        [COPY.closes, draft.closes],
      ],
      title: typed.title,
      lines: draft.items.map((item) => {
        const line = lineFigure(item, draft.decimals);
        return {
          description: item.description.trim() || COPY.noItem,
          quantity: item.quantity.trim() || "—",
          unitPrice: typeof line === "string" ? "—" : money(line.price),
          amount: typeof line === "string" ? "—" : money(line.units),
        };
      }),
      totals:
        draft.clientFee > 0n
          ? [
              [FEES_FORM_COPY.subtotal, money(draft.total)],
              [FEES_FORM_COPY.networkFee, money(draft.clientFee)],
              [COPY.total, due],
            ]
          : [[COPY.total, money(draft.total)]],
      note: typed.note,
      pay: token
        ? [COPY.payExact(due, network, token.chainId), COPY.payContract(token.symbol, token.token)]
        : [COPY.payAny(due), COPY.payPick],
    },
    payer: { name: sender, amount: due, network: token ? COPY.on(network) : COPY.any },
    email: {
      subject: sender ? COPY.emailSubject(COPY.kind, sender) : `${COPY.kind} ${COPY.draft}`,
      lead: COPY.emailLead(sender || COPY.someone, due),
      details: [
        [COPY.kind, COPY.draft],
        ...(draft.dueDate ? [[COPY.due, formatDueDate(draft.dueDate)] as const] : []),
        [COPY.network, token ? network : COPY.payerPicks],
      ],
    },
  };
}
