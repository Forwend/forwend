import { z } from "zod";
import { apiTime } from "@/shared/schemas/api";

/**
 * The PUT /v1/profiles/{profileId}/clients/{clientId} body, and the client block an invoice copies (R-86); "" means
 * none. A saved client needs a name; an invoice's client block may leave every field empty.
 */
export const clientBodySchema = z.object({
  name: z.string(),
  email: z.string(),
  address: z.string(),
  // ISO 3166-1 alpha-2, upper case.
  country: z.string().regex(/^([A-Z]{2})?$/),
  taxId: z.string(),
});

/** The PUT body: the client block and the PO number or reference New invoice fills in (R-90). */
export const savedClientBodySchema = clientBodySchema.extend({ reference: z.string() });

/** One saved client (apps/backend/api/openapi.yaml, Client). */
export const clientSchema = z.object({
  clientId: z.guid(),
  name: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
  reference: z.string().nullable(),
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/clients. */
export const clientsSchema = z.object({ clients: z.array(clientSchema) });
