import { z } from "zod";
import {
  DELIVERY_STATUSES,
  TEST_EVENT,
  WEBHOOK_EVENTS,
} from "@/features/webhooks/constants/webhooks";
import { apiTime } from "@/shared/schemas/api";

/** One webhook endpoint (apps/backend/api/openapi.yaml, WebhookEndpoint); never its secret. */
export const endpointSchema = z.object({
  endpointId: z.guid(),
  url: z.string(),
  description: z.string(),
  // A merchant endpoint's one store; null for all of them, and for a freelancer's.
  storeId: z.guid().nullable(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  enabled: z.boolean(),
  livemode: z.boolean(),
  createdAt: apiTime,
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/webhooks: newest first. */
export const endpointsSchema = z.object({ endpoints: z.array(endpointSchema) });

export const endpointBodySchema = z.object({
  url: z.string(),
  description: z.string(),
  storeId: z.guid().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean(),
});

/** The working signing secrets, newest first: during a rotation's 24 hours, the old one too. */
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
  // Null for a test event; number is null too before a payment-link invoice's first deposit.
  invoiceId: z.string().nullable(),
  number: z.number().int().positive().nullable(),
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

/** GET .../deliveries: the newest 50. */
export const deliveriesSchema = z.object({ deliveries: z.array(deliverySchema) });

export const resentSchema = z.object({ resent: z.number().int().nonnegative() });

export const testSentSchema = z.object({ eventId: z.string() });
