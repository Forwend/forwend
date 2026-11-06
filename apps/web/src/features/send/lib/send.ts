import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { Balances } from "@/features/balances/types/balances";
import { ROLES } from "@/features/profiles/constants/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { Send, SendOption, SendRequest } from "@/features/send/types/send";
import { evmAddress } from "@/shared/schemas/api";

export function isWalletAddress(text: string): boolean {
  return evmAddress.safeParse(text.trim()).success;
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
  to: string,
): boolean {
  return (
    send.chainId === request.chainId &&
    send.token.toLowerCase() === request.token.toLowerCase() &&
    send.amount === request.amount &&
    send.to.toLowerCase() === to.toLowerCase()
  );
}

/** The network fee the wallet pays (D-119): Free where Forwend pays it.
 * ponytail: a non-zero fee is shown in the sent token's units; only sponsored chains offer Send today, so it is
 * always 0. Name the gas token here once a chain without sponsorship offers Send. */
export function feeText(send: Send, option: SendOption): string {
  const fee = BigInt(send.networkFee.amount);
  return fee === 0n ? SEND_COPY.free : `${maxAmount(fee, option.decimals)} ${option.symbol}`;
}

/** The owner's other profiles with a wallet: where a Transfer can go. */
export function transferTargets(profiles: Profile[], from: Profile): Profile[] {
  return profiles.filter(
    (p) => p.profileId !== from.profileId && p.role === ROLES.owner && p.walletAddress,
  );
}
