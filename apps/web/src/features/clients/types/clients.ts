import type { z } from "zod";
import type {
  clientBodySchema,
  clientSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";

export type Client = z.infer<typeof clientSchema>;

export type ClientBody = z.infer<typeof clientBodySchema>;

export type SavedClientBody = z.infer<typeof savedClientBodySchema>;

/** The saved client's typed fields, which the API may name as invalid; reminders is a checkbox. */
export type ClientTextField = Exclude<keyof SavedClientBody, "reminders">;
