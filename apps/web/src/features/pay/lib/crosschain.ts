import { sha256 } from "@noble/hashes/sha2.js";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  ONECLICK_KEY,
  ONECLICK_SLIPPAGE_BPS,
  ONECLICK_TEST_KEY,
  POPULAR_BLOCKCHAINS,
  QUOTE_ADDRESS_LEAST_MS,
  QUOTE_PRICE_WINDOW_MS,
} from "@/features/pay/constants/crosschain";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { withOption } from "@/features/pay/lib/pay";
import { checkedReceiveAddress } from "@/features/pay/lib/receive-address";
import { apiError } from "@/shared/api/api-error";
import { CROSS_CHAIN_TARGET } from "@/shared/constants/chains";
import { blockchainName, isCrossChainTarget } from "@/shared/lib/chains";

export interface CrossChainTarget {
  receive: string;
  due: bigint;
  closesAt: number;
}

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

// As 1Click's SDK verifyQuoteSignature reads them: an optional field counts only when truthy.
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
// Forwend never asks for these: a quote carrying one was asked by someone else.
const NEVER_ASKED = ["virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"];

type Answer = { [key: string]: unknown };

const record = (value: unknown): Answer | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Answer) : null;

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

export interface QuoteAsk {
  recipient: string;
  amount: string;
  originAsset: string;
  refundTo: string;
}

/** The page shows a deposit address only for a fresh quote 1Click signed for exactly what it asked. */
export async function verifyQuote(
  signed: unknown,
  ask: QuoteAsk,
  key = crossChainKey(),
  now = Date.now(),
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
  const signedAt = typeof answer.timestamp === "string" ? Date.parse(answer.timestamp) : NaN;
  const addressUntil = typeof quote.deadline === "string" ? Date.parse(quote.deadline) : NaN;
  const fresh =
    now - signedAt <= QUOTE_PRICE_WINDOW_MS && addressUntil >= now + QUOTE_ADDRESS_LEAST_MS;
  if (!asked || !fresh) return false;
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

export function signedDeposit(
  signed: unknown,
  decimals: number,
): {
  depositAddress: string;
  amountIn: bigint;
  minAmountIn: bigint;
  refundFee: bigint;
  send: bigint;
} | null {
  const quote = record(record(signed)?.quote);
  const units = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
  const amountIn = units(quote?.amountIn);
  const minAmountIn = units(quote?.minAmountIn);
  if (typeof quote?.depositAddress !== "string" || amountIn === null || minAmountIn === null)
    return null;
  const usd = typeof quote.amountInUsd === "string" ? quote.amountInUsd : "";
  return {
    depositAddress: quote.depositAddress,
    amountIn,
    minAmountIn,
    refundFee: units(quote.refundFee) ?? 0n,
    send: sendUnits(amountIn, decimals, usdPerToken(usd, amountIn, decimals)),
  };
}

/** At or under the refund fee, 1Click's spec doesn't say a refund is sent at all. */
export function slippageCoversRefundFee(
  send: bigint,
  minAmountIn: bigint,
  refundFee: bigint,
): boolean {
  return send - minAmountIn > refundFee;
}

export function usdPerToken(amountInUsd: string, amountIn: bigint, decimals: number): number {
  return Number(amountInUsd) / (Number(amountIn) / 10 ** decimals);
}

const SEND_DIGITS = 5;

/** Rounded up to the cent for a stablecoin, else to 5 digits; 1Click refunds the extra units. */
export function sendUnits(units: bigint, decimals: number, usdPerWholeToken: number): bigint {
  const stable = usdPerWholeToken >= 0.98 && usdPerWholeToken <= 1.02;
  const dropped = stable
    ? Math.max(decimals - 2, 0)
    : Math.max(units.toString().length - SEND_DIGITS, 0);
  const step = 10n ** BigInt(dropped);
  return ((units + step - 1n) / step) * step;
}

export function crossChainFeeUsd(q: {
  amountIn: string;
  minAmountIn: string;
  amountInUsd: string;
  amountOutUsd: string;
}): number {
  const perUnit = Number(q.amountInUsd) / Number(q.amountIn);
  return Math.max(0, Number(q.minAmountIn) * perUnit - Number(q.amountOutUsd));
}

export function crossChainKey(
  host = typeof location === "undefined" ? "" : location.hostname,
  testKey: string = ONECLICK_TEST_KEY,
): string {
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return testKey && loopback ? testKey : ONECLICK_KEY;
}

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

export function bufferLine(send: bigint, minAmountIn: bigint, refundFee: bigint): string {
  return slippageCoversRefundFee(send, minAmountIn, refundFee)
    ? PAY_COPY.crossChain.bufferBack
    : PAY_COPY.crossChain.bufferUnderFee;
}

export function quoteProblem(error: unknown): string {
  switch (apiError(error).code) {
    case "below_minimum":
      return PAY_COPY.crossChain.belowMinimum;
    case "no_liquidity":
      return PAY_COPY.crossChain.cantConvert;
    case "invalid_value":
      return PAY_COPY.crossChain.refused;
    case "quote_refused":
      return PAY_COPY.crossChain.quoteRefused;
    case "too_many_quotes":
    case "rate_limited":
      return PAY_COPY.crossChain.tooMany;
    case "crosschain_unavailable":
      return PAY_COPY.crossChain.closed;
    default:
      return PAY_COPY.crossChain.unavailable;
  }
}

export function priceProblem(error: unknown): string {
  return apiError(error).code === "invalid_value"
    ? PAY_COPY.crossChain.cantConvert
    : quoteProblem(error);
}
