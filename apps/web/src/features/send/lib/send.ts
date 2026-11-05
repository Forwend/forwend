import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { Balances } from "@/features/balances/types/balances";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { evmAddress } from "@/shared/schemas/api";

/** A token on one network that the wallet holds. */
export interface SendOption {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  sendable: boolean;
}

export function isWalletAddress(text: string): boolean {
  return evmAddress.safeParse(text.trim()).success;
}

/** The address in groups of four after 0x, so the owner can compare it group by group (R-213). */
export function addressGroups(address: string): string[] {
  return ["0x", ...(address.slice(2).match(/.{1,4}/g) ?? [])];
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
