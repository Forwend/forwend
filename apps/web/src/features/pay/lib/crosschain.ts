import { formatTokenAmount } from "@forwend/ui-web";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  ONECLICK_KEY,
  ONECLICK_SLIPPAGE_BPS,
  ONECLICK_TEST_KEY,
  POPULAR_BLOCKCHAINS,
} from "@/features/pay/constants/crosschain";
import { withOption } from "@/features/pay/lib/pay";
import { checkedReceiveAddress } from "@/features/pay/lib/receive-address";
import { CROSS_CHAIN_TARGET } from "@/shared/constants/chains";
import { blockchainName, isCrossChainTarget } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

/** What a payer pays into from another chain (D-123): the open Base USDC option of a live invoice. */
export interface CrossChainTarget {
  /** Its receive address, as this page computed it from the terms. */
  receive: string;
  /** What is still due on it, in its base units. */
  due: bigint;
  /** Its close, in ms. */
  closesAt: number;
}

/** Null for a test-mode invoice, one without a Base USDC option, or terms that don't compute to its address. */
export function crossChainTarget(inv: Invoice, payToken: string): CrossChainTarget | null {
  const base = inv.options.find(isCrossChainTarget);
  if (!inv.livemode || !base) return null;
  const shown = withOption(inv, base.optionId);
  if (shown.optionId !== base.optionId) return null; // money chose another option
  const receive = checkedReceiveAddress(shown, payToken);
  if (!receive) return null;
  const paid = BigInt(base.amounts?.payable ?? "0");
  const due = BigInt(base.amount) - (paid > 0n ? paid : 0n);
  return due > 0n ? { receive, due, closesAt: Date.parse(base.closesAt ?? inv.closesAt) } : null;
}

// The fields 1Click signs, as its SDK's verifyQuoteSignature reads them (D-124). An optional one counts only when it
// is truthy, as the SDK drops it otherwise; a real quote's fields are spread over the request's.
const SIGNED_REQUEST = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
];
const OPTIONAL_REQUEST = [
  "quoteWaitingTimeMs",
  "referral",
  "virtualChainRecipient",
  "virtualChainRefundRecipient",
  "customRecipientMsg",
];
const SIGNED_AMOUNTS = [
  "amountIn",
  "amountInFormatted",
  "amountInUsd",
  "minAmountIn",
  "amountOut",
  "amountOutFormatted",
  "amountOutUsd",
  "minAmountOut",
];
const OPTIONAL_QUOTE = [
  "depositAddress",
  "depositMemo",
  "deadline",
  "timeWhenInactive",
  "timeEstimate",
  "refundFee",
  "withdrawFee",
];
// Signed when set, but Forwend never asks for them: a quote carrying one was asked by someone else.
const NEVER_ASKED = ["virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"];

type Answer = { [key: string]: unknown };

const record = (value: unknown): Answer | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Answer) : null;

/** The text 1Click signs for a quote answer: the base58 SHA-256 of its signed fields as sorted-key JSON. */
export function quoteMessage(answer: Answer): string {
  const request = record(answer.quoteRequest) ?? {};
  const quote = record(answer.quote) ?? {};
  const fields: Answer = {};
  for (const k of SIGNED_REQUEST) if (k in request) fields[k] = request[k];
  for (const k of OPTIONAL_REQUEST) if (request[k]) fields[k] = request[k];
  for (const k of SIGNED_AMOUNTS) if (k in quote) fields[k] = quote[k];
  if (request.dry !== true) {
    for (const k of OPTIONAL_QUOTE) {
      if (quote[k]) fields[k] = quote[k];
      else delete fields[k];
    }
  }
  if ("timestamp" in answer) fields.timestamp = answer.timestamp;
  const sorted = Object.fromEntries(
    Object.keys(fields)
      .sort()
      .filter((k) => fields[k] !== undefined)
      .map((k) => [k, fields[k]]),
  );
  return base58(sha256(new TextEncoder().encode(JSON.stringify(sorted))));
}

/** What the pay page asked 1Click for: exactly amount of Base USDC to the receive address the page computed. */
export interface QuoteAsk {
  recipient: string;
  amount: string;
  originAsset: string;
  refundTo: string;
}

/**
 * Whether signed is a quote 1Click signed with key that pays exactly ask (D-124): the page shows a deposit address only
 * then. A hacked api can't pass another address, recipient, amount or refund address.
 */
export async function verifyQuote(
  signed: unknown,
  ask: QuoteAsk,
  key = crossChainKey(),
): Promise<boolean> {
  const answer = record(signed);
  const request = record(answer?.quoteRequest);
  const quote = record(answer?.quote);
  if (!answer || !request || !quote || typeof answer.signature !== "string") return false;
  const sameAddress = (a: unknown, b: string) =>
    typeof a === "string" &&
    (/^0x[0-9a-fA-F]{40}$/.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b);
  const asked =
    request.dry === false &&
    request.swapType === "EXACT_OUTPUT" &&
    request.slippageTolerance === ONECLICK_SLIPPAGE_BPS &&
    request.depositType === "ORIGIN_CHAIN" &&
    request.destinationAsset === CROSS_CHAIN_TARGET.asset &&
    request.recipientType === "DESTINATION_CHAIN" &&
    request.refundType === "ORIGIN_CHAIN" &&
    request.originAsset === ask.originAsset &&
    request.amount === ask.amount &&
    sameAddress(request.recipient, ask.recipient) &&
    sameAddress(request.refundTo, ask.refundTo) &&
    !NEVER_ASKED.some((k) => request[k]) &&
    quote.amountOut === ask.amount &&
    quote.minAmountOut === ask.amount &&
    typeof quote.depositAddress === "string" &&
    quote.depositAddress !== "" &&
    !quote.depositMemo;
  if (!asked) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromBase58(key),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      fromBase58(answer.signature),
      new TextEncoder().encode(quoteMessage(answer)),
    );
  } catch {
    return false;
  }
}

/** The deposit address and amount inside a signed answer: after verifyQuote, the only ones the page may show. send
 * is the amount the payer is asked for: amountIn rounded up at the price 1Click signed (R-244). */
export function signedDeposit(
  signed: unknown,
  decimals: number,
): { depositAddress: string; amountIn: bigint; send: bigint } | null {
  const quote = record(record(signed)?.quote);
  if (
    typeof quote?.depositAddress !== "string" ||
    typeof quote.amountIn !== "string" ||
    !/^\d+$/.test(quote.amountIn)
  )
    return null;
  const amountIn = BigInt(quote.amountIn);
  const usd = typeof quote.amountInUsd === "string" ? quote.amountInUsd : "";
  return {
    depositAddress: quote.depositAddress,
    amountIn,
    send: sendUnits(amountIn, decimals, usdPerToken(usd, amountIn, decimals)),
  };
}

/** An amount of a token as the pay box writes it: every digit it has, at least two. */
export const amountText = (units: bigint, token: { decimals: number; symbol: string }) =>
  `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;

/** USD for one whole token, at the price 1Click valued amountIn at. */
export function usdPerToken(amountInUsd: string, amountIn: bigint, decimals: number): number {
  return Number(amountInUsd) / (Number(amountIn) / 10 ** decimals);
}

const SEND_DIGITS = 5;

/**
 * R-244: what a payer is asked to send, rounded up so it reads like money: a USD stablecoin (priced within 2% of 1 USD,
 * as the api orders them) to the cent, any other token to 5 significant digits. The few units it adds come back with
 * the unused slippage, as 1Click refunds any deposit over what the conversion takes.
 */
export function sendUnits(units: bigint, decimals: number, usdPerWholeToken: number): bigint {
  const stable = usdPerWholeToken >= 0.98 && usdPerWholeToken <= 1.02;
  const dropped = stable
    ? Math.max(decimals - 2, 0)
    : Math.max(units.toString().length - SEND_DIGITS, 0);
  const step = 10n ** BigInt(dropped);
  return ((units + step - 1n) / step) * step;
}

/** R-244: NEAR Intents' fee and Base's network fee in USD, at 1Click's prices: what the least it converts is worth
 * over what arrives. The slippage on top comes back, so it is no fee. */
export function crossChainFeeUsd(q: {
  amountIn: string;
  minAmountIn: string;
  amountInUsd: string;
  amountOutUsd: string;
}): number {
  const perUnit = Number(q.amountInUsd) / Number(q.amountIn);
  return Math.max(0, Number(q.minAmountIn) * perUnit - Number(q.amountOutUsd));
}

/** 1Click's key; a test build's fake key only on a page served from loopback, never on a real host. */
export function crossChainKey(
  host = typeof location === "undefined" ? "" : location.hostname,
  testKey: string = ONECLICK_TEST_KEY,
): string {
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return testKey && loopback ? testKey : ONECLICK_KEY;
}

/** Chains in the picker's order: the popular ones first, then by name. */
export function orderBlockchains(blockchains: readonly string[]): string[] {
  const rank = (b: string) => {
    const i = (POPULAR_BLOCKCHAINS as readonly string[]).indexOf(b);
    return i < 0 ? POPULAR_BLOCKCHAINS.length : i;
  };
  return [...new Set(blockchains)].sort(
    (a, b) => rank(a) - rank(b) || blockchainName(a).localeCompare(blockchainName(b)),
  );
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Reads "ed25519:<base58>"; throws on any other character. */
export function fromBase58(text: string): Uint8Array<ArrayBuffer> {
  const s = text.replace(/^ed25519:/, "");
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}
