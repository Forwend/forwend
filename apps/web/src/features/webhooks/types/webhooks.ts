import type { z } from "zod";
import type { DELIVERY_STATUSES, WEBHOOK_EVENTS } from "@/features/webhooks/constants/webhooks";
import type {
  deliverySchema,
  endpointBodySchema,
  endpointSchema,
  secretsSchema,
} from "@/features/webhooks/schemas/webhooks";

export type WebhookEndpoint = z.infer<typeof endpointSchema>;

export type EndpointBody = z.infer<typeof endpointBodySchema>;

export type WebhookSecret = z.infer<typeof secretsSchema>["secrets"][number];

export type Delivery = z.infer<typeof deliverySchema>;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[keyof typeof DELIVERY_STATUSES];
