import { Badge, TONES, type Tone } from "@forwend/ui-web";
import { DELIVERY_STATUSES } from "@/features/webhooks/constants/webhooks";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import type { DeliveryStatus } from "@/features/webhooks/types/webhooks";

const TONE: Record<DeliveryStatus, Tone> = {
  [DELIVERY_STATUSES.pending]: TONES.neutral,
  [DELIVERY_STATUSES.succeeded]: TONES.success,
  [DELIVERY_STATUSES.failed]: TONES.danger,
};

export interface DeliveryStatusBadgeProps {
  status: DeliveryStatus;
}

export function DeliveryStatusBadge({ status }: DeliveryStatusBadgeProps) {
  return <Badge tone={TONE[status]}>{COPY.status[status]}</Badge>;
}
