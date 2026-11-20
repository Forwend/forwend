import { z } from "zod";
import {
  DELIVERY_STATUSES,
  TEST_EVENT,
  WEBHOOK_EVENTS,
} from "@/features/webhooks/constants/webhooks";
import { apiTime } from "@/shared/schemas/api";

export const endpointSchema = z.object({
  endpointId: z.guid(),
  url: z.string(),
  description: z.string(),
  storeId: z.guid().nullable(), // null for all stores
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  enabled: z.boolean(),
  livemode: z.boolean(),
  createdAt: apiTime,
  updatedAt: apiTime,
});

export const endpointsSchema = z.object({ endpoints: z.array(endpointSchema) });

export const endpointBodySchema = z.object({
  url: z.string(),
  description: z.string(),
  storeId: z.guid().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean(),
});

/** Newest first: during a rotation's 24 hours, the old one too. */
export const secretsSchema = z.object({
  secrets: z.array(
    z.object({
      secret: z.string().regex(/^whsec_[A-Za-z0-9+/]{43}=$/),
      createdAt: apiTime,
      expiresAt: apiTime.nullable(),
    }),
  ),
});

export const deliverySchema = z.object({
  eventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
  type: z.enum([...WEBHOOK_EVENTS, TEST_EVENT]),
  invoiceId: z.string().nullable(), // null for a test event
  number: z.number().int().positive().nullable(), // null before a link's first deposit
  status: z.enum(Object.values(DELIVERY_STATUSES)),
  nextAttemptAt: apiTime.nullable(),
  createdAt: apiTime,
  attempts: z.array(
    z.object({
      at: apiTime,
      statusCode: z.number().int().nullable(),
      error: z.string().nullable(),
      durationMs: z.number().int().nonnegative(),
    }),
  ),
});

export const deliveriesSchema = z.object({ deliveries: z.array(deliverySchema) });

export const resentSchema = z.object({ resent: z.number().int().nonnegative() });

export const testSentSchema = z.object({ eventId: z.string() });
