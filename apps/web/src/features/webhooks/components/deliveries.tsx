"use client";

import {
  Badge,
  BUTTON_VARIANTS,
  Button,
  buttonClasses,
  EmptyState,
  SelectField,
  TONES,
  type Tone,
  useToast,
} from "@forwend/ui-web";
import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import {
  useListDeliveriesQuery,
  useResendDeliveryMutation,
  useResendFailedMutation,
  useSendTestMutation,
} from "@/features/webhooks/api/webhooks-api";
import {
  DEFAULT_FAILED_SINCE_HOURS,
  DELIVERY_STATUSES,
  FAILED_SINCE_HOURS,
  TEST_EVENT,
} from "@/features/webhooks/constants/webhooks";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import type { Delivery, DeliveryStatus, WebhookEndpoint } from "@/features/webhooks/types/webhooks";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

export interface DeliveriesProps {
  profileId: string;
  endpoint: WebhookEndpoint;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const HOUR = 60 * 60 * 1000;

const TONE: Record<DeliveryStatus, Tone> = {
  [DELIVERY_STATUSES.pending]: TONES.info,
  [DELIVERY_STATUSES.succeeded]: TONES.success,
  [DELIVERY_STATUSES.failed]: TONES.danger,
};

// R-149: the endpoint's newest deliveries with each attempt, a resend for any one, a test event, and a resend of the
// failed ones in a window.
export function Deliveries({ profileId, endpoint }: DeliveriesProps) {
  const arg = { profileId, endpointId: endpoint.endpointId };
  // The worker sends while the sheet is open: a test event turns Delivered without a reload.
  const deliveries = useListDeliveriesQuery(arg, LIVE_QUERY);
  const [sendTest, testing] = useSendTestMutation();
  const [resendFailed, resending] = useResendFailedMutation();
  const [hours, setHours] = useState(String(DEFAULT_FAILED_SINCE_HOURS));
  const toast = useToast();
  const failed = () => toast({ tone: TONES.danger, title: COPY.errors.action });
  const test = async () => {
    try {
      await sendTest(arg).unwrap();
      toast({ tone: TONES.success, title: COPY.testSent });
    } catch {
      failed();
    }
  };
  const recover = async () => {
    try {
      const since = new Date(Date.now() - Number(hours) * HOUR).toISOString();
      const n = await resendFailed({ ...arg, since }).unwrap();
      toast({ tone: TONES.success, title: COPY.resentCount(n) });
    } catch {
      failed();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {endpoint.enabled ? null : (
        <p role="status" className="text-sm text-muted">
          {COPY.offNotice}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant={BUTTON_VARIANTS.secondary}
          loading={testing.isLoading}
          onClick={() => void test()}
        >
          <Send aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.sendTest}
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label={COPY.since}
            value={hours}
            onValueChange={setHours}
            options={FAILED_SINCE_HOURS.map((h) => ({
              value: String(h),
              label: COPY.sinceLabels[h],
            }))}
          />
          <Button
            variant={BUTTON_VARIANTS.secondary}
            loading={resending.isLoading}
            onClick={() => void recover()}
          >
            {COPY.resendFailed}
          </Button>
        </div>
      </div>
      {deliveries.isError && !deliveries.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.deliveriesFailed}
          <Button size="sm" variant="secondary" onClick={() => void deliveries.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !deliveries.currentData ? (
        <RowsSkeleton count={3} className="fw-panel" />
      ) : deliveries.currentData.length === 0 ? (
        <EmptyState icon={Send} title={COPY.noDeliveries} description={COPY.noDeliveriesBody} />
      ) : (
        <ul className="fw-panel divide-y divide-line">
          {deliveries.currentData.map((d) => (
            <DeliveryRow
              key={d.eventId}
              profileId={profileId}
              endpointId={endpoint.endpointId}
              delivery={d}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliveryRow({
  profileId,
  endpointId,
  delivery: d,
}: {
  profileId: string;
  endpointId: string;
  delivery: Delivery;
}) {
  const [resend, resending] = useResendDeliveryMutation();
  const toast = useToast();
  const name = d.type === TEST_EVENT ? COPY.testEvent : COPY.eventLabels[d.type];
  const again = async () => {
    try {
      await resend({ profileId, endpointId, eventId: d.eventId }).unwrap();
      toast({ tone: TONES.success, title: COPY.resent });
    } catch {
      toast({ tone: TONES.danger, title: COPY.errors.action });
    }
  };
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">
            {name}
            {d.invoiceId && d.number !== null ? (
              <>
                {" · "}
                <Link
                  href={`${APP_ROUTES.invoices}/${d.invoiceId}`}
                  className={buttonClasses({ variant: BUTTON_VARIANTS.link })}
                >
                  {invoiceNumber(d.number)}
                </Link>
              </>
            ) : null}
          </span>
          <span className="block text-sm text-muted">
            {WHEN.format(new Date(d.createdAt))}
            {d.nextAttemptAt ? ` · ${COPY.nextTry(WHEN.format(new Date(d.nextAttemptAt)))}` : null}
          </span>
        </span>
        <Badge tone={TONE[d.status]}>{COPY.status[d.status]}</Badge>
        <Button
          size="sm"
          variant={BUTTON_VARIANTS.secondary}
          loading={resending.isLoading}
          aria-label={COPY.resendOne(
            d.number === null ? name : `${name} ${invoiceNumber(d.number)}`,
            WHEN.format(new Date(d.createdAt)),
          )}
          onClick={() => void again()}
        >
          {COPY.resend}
        </Button>
      </div>
      {d.attempts.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            {COPY.attempts(d.attempts.length)}
          </summary>
          <ol className="mt-2 flex flex-col gap-1">
            {d.attempts.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: attempts only append, so the position names one
              <li key={i} className="flex flex-wrap gap-x-3 text-muted">
                <span>{WHEN.format(new Date(a.at))}</span>
                <span className="font-mono text-ink">{a.statusCode ?? COPY.noAnswer}</span>
                {a.error ? <span className="break-words">{a.error}</span> : null}
                <span>{COPY.took(a.durationMs)}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}
