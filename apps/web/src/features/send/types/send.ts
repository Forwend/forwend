import type { z } from "zod";
import type { Profile } from "@/features/profiles/types/profile";
import type { SEND_MODES, SEND_STEPS } from "@/features/send/constants/send";
import type { sendFeeSchema, sendSchema } from "@/features/send/schemas/send";

export type SendMode = (typeof SEND_MODES)[keyof typeof SEND_MODES];

export type SendStep = (typeof SEND_STEPS)[keyof typeof SEND_STEPS];

export type Send = z.infer<typeof sendSchema>;

export type SendFee = z.infer<typeof sendFeeSchema>;

export type Signed = { txHash: string } | { signature: string };

export interface Relay {
  signature: string;
  until: number; // Unix ms the Privy request expires
}

export interface SendRequest {
  profileId: string;
  chainId: number;
  token: string;
  to?: string;
  toProfileId?: string;
  amount: string;
}

export type Recipient = { profile: Profile } | { address: string };

export interface SendOption {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  sendable: boolean;
}
