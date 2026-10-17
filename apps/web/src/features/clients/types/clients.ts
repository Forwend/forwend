import type { z } from "zod";
import type {
  clientBodySchema,
  clientSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";

export type Client = z.infer<typeof clientSchema>;

export type ClientBody = z.infer<typeof clientBodySchema>;

export type SavedClientBody = z.infer<typeof savedClientBodySchema>;
