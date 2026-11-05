import type { z } from "zod";
import type { Profile } from "@/features/profiles/types/profile";
import type { SEND_MODES, SEND_STEPS } from "@/features/send/constants/send";
import type { sendSchema } from "@/features/send/schemas/send";

export type SendMode = (typeof SEND_MODES)[keyof typeof SEND_MODES];

export type SendStep = (typeof SEND_STEPS)[keyof typeof SEND_STEPS];

export type Send = z.infer<typeof sendSchema>;

/** What the owner asks to send: to an outside address, or to another of their profiles. */
export interface SendRequest {
  profileId: string;
  chainId: number;
  token: string;
  to?: string;
  toProfileId?: string;
  amount: string;
}

/** Who gets the money: another of the owner's profiles, or an outside address. */
export type Recipient = { profile: Profile } | { address: string };

/** A token on one network that the wallet holds. */
export interface SendOption {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  sendable: boolean;
}
