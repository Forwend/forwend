import type { z } from "zod";
import type { AMOUNT_KINDS, LINK_STATES } from "@/features/links/constants/links";
import type { linkBodySchema, linkSchema } from "@/features/links/schemas/links";

export type Link = z.infer<typeof linkSchema>;

export type LinkBody = z.infer<typeof linkBodySchema>;

export type LinkState = (typeof LINK_STATES)[keyof typeof LINK_STATES];

export type AmountKind = (typeof AMOUNT_KINDS)[keyof typeof AMOUNT_KINDS];

/** The fields the form checks, and the API names when it refuses one. */
export type LinkField = "title" | "amountUsd" | "minUsd" | "maxUsd" | "maxPayments";
