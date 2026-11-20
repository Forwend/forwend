import { z } from "zod";
import { apiTime, pageOf } from "@/shared/schemas/api";

/** "" means none; an invoice's client block may be all empty. */
export const clientBodySchema = z.object({
  name: z.string(),
  email: z.string(),
  address: z.string(),
  country: z.string().regex(/^([A-Z]{2})?$/), // ISO 3166-1 alpha-2
  taxId: z.string(),
});

export const savedClientBodySchema = clientBodySchema.extend({
  reference: z.string(),
  reminders: z.boolean(),
});

export const clientSchema = z.object({
  clientId: z.guid(),
  name: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
  reference: z.string().nullable(),
  reminders: z.boolean(),
  updatedAt: apiTime,
});

export const clientsPageSchema = pageOf(clientSchema);
