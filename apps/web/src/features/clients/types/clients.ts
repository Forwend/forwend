import type { z } from "zod";
import type { CLIENT_KINDS } from "@/features/clients/constants/clients";
import type {
  clientBodySchema,
  clientSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";

export type Client = z.infer<typeof clientSchema>;

export type ClientBody = z.infer<typeof clientBodySchema>;

export type SavedClientBody = z.infer<typeof savedClientBodySchema>;

export type ClientTextField = Exclude<keyof SavedClientBody, "reminders">;

export type ClientKind = (typeof CLIENT_KINDS)[keyof typeof CLIENT_KINDS];
