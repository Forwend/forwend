import { formatTokenAmount } from "@forwend/ui-web";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { Balances } from "@/features/balances/types/balances";
import { ROLES } from "@/features/profiles/constants/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { FEE_DECIMALS, FEE_PAYERS, NATIVE_DECIMALS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { Send, SendOption, SendRequest } from "@/features/send/types/send";
import { evmAddress } from "@/shared/schemas/api";

/** An address as the server takes it: one case, or mixed case with a valid EIP-55 checksum, so a mistyped letter is
 * caught on the address step, not after the amount. */
export function isWalletAddress(text: string): boolean {
  const address = text.trim();
  if (!evmAddress.safeParse(address).success) return false;
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = bytesToHex(keccak_256(utf8ToBytes(hex.toLowerCase())));
  return [...hex].every(
    (c, i) => c === (Number.parseInt(hash[i] ?? "0", 16) >= 8 ? c.toUpperCase() : c.toLowerCase()),
  );
}

/** What the wallet holds, the networks Send offers first; empty balances and unread ones are left out. */
export function sendOptions(balances: Balances | null): SendOption[] {
  return (balances?.tokens ?? [])
    .filter((t) => t.wallet !== null && BigInt(t.wallet) > 0n)
    .map((t) => ({
      chainId: t.chainId,
      token: t.token,
      symbol: t.symbol,
      decimals: t.decimals,
      balance: BigInt(t.wallet ?? "0"),
      sendable: t.sendable === true,
    }))
    .sort((a, b) => Number(b.sendable) - Number(a.sendable));
}

/** The API's own words for a refused send, else the general line. */
export function sendError(error: unknown): string {
  const e = error as FetchBaseQueryError | undefined;
  const body = (e?.data as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (body?.code === "send_in_progress") return SEND_COPY.busy;
  if (body?.code === "send_approved") return SEND_COPY.alreadyApproved;
  if ((body?.code === "invalid_value" || body?.code === "transfer_refused") && body.message) {
    const text = body.message.replace(/^invalid send: /, "");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }
  return SEND_COPY.failedToPrepare;
}

/** ERC-20 transfer(to, amount): the one call a send signs. */
export function transferCalldata(to: string, amount: bigint): `0x${string}` {
  const word = (hex: string) => hex.padStart(64, "0");
  return `0xa9059cbb${word(to.slice(2).toLowerCase())}${word(amount.toString(16))}`;
}

/** What Max may send (R-216): the balance less the fee, never below 0; null until the fee is known. */
export function roomForFee(balance: bigint, fee: bigint | null): bigint | null {
  if (fee === null) return null;
  return balance > fee ? balance - fee : 0n;
}

/** The whole balance as the amount field takes it: every decimal it has, no grouping, no trailing zeros. */
export function maxAmount(balance: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (balance % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${balance / scale}.${fraction}` : `${balance / scale}`;
}

/** The server's send is the one the owner asked for: what Privy signs comes from it, so a different answer is
 * refused before the review shows. */
export function matchesRequest(
  send: Send,
  request: Omit<SendRequest, "profileId">,
  expected: { to: string; from: string; decimals: number },
): boolean {
  const { to, from, decimals } = expected;
  return (
    send.chainId === request.chainId &&
    send.from.toLowerCase() === from.toLowerCase() &&
    send.decimals === decimals &&
    send.token.toLowerCase() === request.token.toLowerCase() &&
    send.amount === request.amount &&
    send.to.toLowerCase() === to.toLowerCase() &&
    gasWithinFee(send)
  );
}

/** The gas caps Privy signs with can cost at most the fee the review shows (R-216). A paymaster send has none and an
 * estimated fee (R-225); a send Forwend sponsored had neither. */
function gasWithinFee(send: Send): boolean {
  const fee = BigInt(send.networkFee.amount);
  const gas = send.gas;
  if (send.networkFee.paidBy === FEE_PAYERS.paymaster) return gas === null && fee > 0n;
  if (!gas) return fee === 0n;
  if (fee === 0n || BigInt(gas.maxPriorityFeePerGas) > BigInt(gas.maxFeePerGas)) return false;
  const scale = 10n ** BigInt(NATIVE_DECIMALS - send.decimals);
  return BigInt(gas.limit) * BigInt(gas.maxFeePerGas) <= fee * scale;
}

const PRIVY_RPC_URL = /^https:\/\/api\.privy\.io\/v1\/wallets\/[^/]+\/rpc$/;

/** The latest a signed Privy request may expire: the approval's hold is 2 minutes, and a device clock may be off. */
const PRIVY_REQUEST_LIFE_MS = 15 * 60_000;

const sameKeys = (o: unknown, keys: string[]) =>
  typeof o === "object" &&
  o !== null &&
  Object.keys(o).length === keys.length &&
  keys.every((k) => k in o);

/** The server's Privy request for a paymaster send is the review's transfer and nothing else (R-225): the token's
 * transfer(to, amount) from the wallet, its fee in the token, to Privy's wallet API, once (the send is its
 * idempotency key and reference) and soon (it can't be sent again after Privy's idempotency window). The URL's
 * wallet is the server's, as the body is: it reads it from the same row as the sending address. */
export function matchesPrivyRequest(
  send: Send,
  request: NonNullable<Send["privyRequest"]>,
  now = Date.now(),
): boolean {
  const { body, headers } = request;
  const params = body.params as { transaction?: Record<string, unknown> } | undefined;
  const tx = params?.transaction ?? {};
  const asset = (body.sponsor_options as { asset?: unknown } | undefined)?.asset;
  const expiry = Number(headers["privy-request-expiry"]);
  return (
    PRIVY_RPC_URL.test(request.url) &&
    sameKeys(headers, ["privy-app-id", "privy-idempotency-key", "privy-request-expiry"]) &&
    headers["privy-idempotency-key"] === send.sendId &&
    Number.isSafeInteger(expiry) &&
    expiry <= now + PRIVY_REQUEST_LIFE_MS &&
    sameKeys(body, [
      "method",
      "caip2",
      "chain_type",
      "sponsor",
      "sponsor_options",
      "reference_id",
      "params",
    ]) &&
    body.method === "eth_sendTransaction" &&
    body.caip2 === `eip155:${send.chainId}` &&
    body.chain_type === "ethereum" &&
    body.sponsor === true &&
    sameKeys(body.sponsor_options, ["asset"]) &&
    asset === send.symbol.toLowerCase() &&
    body.reference_id === send.sendId &&
    sameKeys(params, ["transaction"]) &&
    sameKeys(tx, ["from", "to", "data", "value", "chain_id"]) &&
    typeof tx.from === "string" &&
    tx.from.toLowerCase() === send.from.toLowerCase() &&
    typeof tx.to === "string" &&
    tx.to.toLowerCase() === send.token.toLowerCase() &&
    tx.data === transferCalldata(send.to, BigInt(send.amount)) &&
    tx.value === "0x0" &&
    tx.chain_id === `0x${send.chainId.toString(16)}`
  );
}

/** An estimated fee rounded up to 4 decimals, so the figure shown is never below what the wallet can pay (R-216). */
export function feeShown(fee: bigint, decimals: number): bigint {
  if (decimals <= FEE_DECIMALS) return fee;
  const step = 10n ** BigInt(decimals - FEE_DECIMALS);
  return ((fee + step - 1n) / step) * step;
}

/** The network fee as a wallet writes it (D-119): Free where Forwend pays, else ≈ the estimate in the token. */
export function feeLabel(fee: bigint, option: Pick<SendOption, "decimals" | "symbol">): string {
  if (fee === 0n) return SEND_COPY.free;
  const shown = feeShown(fee, option.decimals);
  const text = formatTokenAmount({
    baseUnits: shown,
    decimals: option.decimals,
    fractionDigits: Math.min(option.decimals, FEE_DECIMALS),
  });
  return SEND_COPY.approx(`${text} ${option.symbol}`);
}

/** The owner's other profiles with a wallet: where a Transfer can go. */
export function transferTargets(profiles: Profile[], from: Profile): Profile[] {
  return profiles.filter(
    (p) => p.profileId !== from.profileId && p.role === ROLES.owner && p.walletAddress,
  );
}
