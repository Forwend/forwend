import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/features/activity/types/activity";
import type { TokenBalance } from "@/features/balances/types/balances";
import type {
  AMOUNT_ERRORS,
  EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_PDFS,
  INVOICE_STEPS,
  PAY_WITH,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";

export type PayWith = (typeof PAY_WITH)[keyof typeof PAY_WITH];

export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;
export type InvoiceField = (typeof INVOICE_FIELDS)[keyof typeof INVOICE_FIELDS];
export type AmountError = (typeof AMOUNT_ERRORS)[keyof typeof AMOUNT_ERRORS];
export type InvoiceStep = (typeof INVOICE_STEPS)[keyof typeof INVOICE_STEPS];
export type InvoicePdf = (typeof INVOICE_PDFS)[keyof typeof INVOICE_PDFS];

/** An enabled token, as GET /v1/profiles/{id}/balances lists it. */
export type InvoiceToken = Pick<TokenBalance, "chainId" | "token" | "symbol" | "decimals">;

export interface InvoiceClient {
  name: string | null;
  email: string | null;
  address: string | null;
}

/** The profile's billing details as they were when the invoice was made. */
export interface InvoiceIssuer {
  name: string;
  address: string;
  country: string;
  taxId: string | null;
  email: string;
}

export interface Deposit {
  txHash: string;
  logIndex: number;
  from: string;
  /** Base units. */
  amount: string;
  blockNumber: number;
  blockTime: string;
  status: ApiDepositStatus | (string & {});
  /** Paid after expiry: held for the payer, never the creator's. */
  late: boolean;
  blocksLeft: number;
  /** The blocks it had to wait when first seen, fixed across reads: blocksTotal - blocksLeft have passed (R-73). */
  blocksTotal: number;
  secondsLeft: number;
}

/** openapi.yaml, InvoiceSummary. */
export interface InvoiceSummary {
  /** The pay link's id. */
  invoiceId: string;
  /** The on-chain id in the terms below: invoiceId, or the chosen or first option's of a payer-chooses invoice. */
  optionId: string;
  /** An option received money, so the payer can't pick another (R-56). */
  optionLocked: boolean;
  /** How many tokens and networks it accepts; 1 for a fixed invoice. */
  optionCount: number;
  /** A payment before expiry is seen and not final: a partly paid invoice reads as confirming meanwhile (R-69). */
  confirming: boolean;
  number: number;
  title: string | null;
  note: string | null;
  /** YYYY-MM-DD; shown only, payment closes at expiresAt. */
  dueDate: string | null;
  /** Only in the owner's answers (create, list and the profile's read); the public GET leaves it out. */
  client?: InvoiceClient;
  issuer: InvoiceIssuer | null;
  /** The name the payer sees when there is no issuer, such as on a personal profile's request. */
  senderName: string | null;
  /** The creator's https link, offered to the payer once paid (R-58). */
  returnUrl: string | null;
  chainId: number;
  token: string;
  /** Base units. */
  amount: string;
  /** The profile wallet that settlement pays. */
  recipient: string;
  receiveAddress: string;
  expiresAt: string;
  settleDeadline: string;
  paymentStatus: ApiPaymentStatus | (string & {});
  settlementStatus: ApiSettlementStatus | (string & {});
  settlementTxHash: string | null;
  createdAt: string;
}
export type SettlementWaitKind = (typeof SETTLEMENT_WAITS)[keyof typeof SETTLEMENT_WAITS];

export interface SettlementWait {
  kind: SettlementWaitKind;
  /** retrying and dailyLimit: when the signer tries again. */
  until: string | null;
  /** finalizing: estimated chain time until the settle is final. */
  secondsLeft: number | null;
}

/** One token and network the invoice accepts, with its own on-chain id, amount and address (R-56). */
export interface InvoiceOption {
  optionId: string;
  chainId: number;
  /** The API's chain name, such as base-sepolia. */
  network: string;
  token: string;
  symbol: string;
  decimals: number;
  /** Base units. */
  amount: string;
  receiveAddress: string;
  /** On an option other than the shown one, these are held for the payer (D-76). */
  deposits: Deposit[];
}

/** An invoice read alone or just created. */
export interface Invoice extends InvoiceSummary {
  /** Every accepted option, the shown one included: one for a fixed invoice. */
  options: InvoiceOption[];
  /** Once paid: the block time of the deposit that completed the amount. */
  paidAt: string | null;
  /** Once settled: when the settlement was recorded as final. */
  settledAt: string | null;
  deposits: Deposit[];
  /** When Check status may run again; null when it may now (R-55). */
  nextCheckAt: string | null;
  /** Only in the owner's reads: null while not paid or once settled. */
  settlementWait?: SettlementWait | null;
}

/** POST /v1/invoices/{id}/recheck (R-55): what Check status found. Amounts in base units. */
export interface Recheck {
  onChain: string;
  recorded: string;
  rescanning: boolean;
  nextCheckAt: string;
  /** Chains of options whose network did not answer; the others were checked (F144). */
  unreadable: number[];
}

export interface InvoicesPage {
  items: InvoiceSummary[];
  nextCursor: string | null;
}

/** Fixed: chainId, token and amount; payer chooses: amountUsd alone (R-56). */
export interface CreateInvoiceBody {
  chainId?: number;
  token?: string;
  amount?: string;
  amountUsd?: string;
  returnUrl: string;
  expiresIn: number;
  title: string;
  note: string;
  dueDate: string;
  senderName: string;
  client: { name: string; email: string; address: string };
}
