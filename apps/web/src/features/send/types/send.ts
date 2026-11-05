import type { z } from "zod";
import type {
  SEND_MODES,
  SEND_STATUSES,
  SEND_STEPS,
  SEND_WARNINGS,
} from "@/features/send/constants/send";
import type { sendSchema } from "@/features/send/schemas/send";

export type SendMode = (typeof SEND_MODES)[keyof typeof SEND_MODES];

export type SendStep = (typeof SEND_STEPS)[keyof typeof SEND_STEPS];

export type SendStatus = (typeof SEND_STATUSES)[keyof typeof SEND_STATUSES];

export type SendWarning = (typeof SEND_WARNINGS)[keyof typeof SEND_WARNINGS];

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
