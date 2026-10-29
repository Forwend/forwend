"use client";

import {
  Badge,
  BUTTON_VARIANTS,
  Button,
  cx,
  EmptyState,
  SelectField,
  Skeleton,
  TONES,
  type Tone,
} from "@forwend/ui-web";
import { ChevronRight, Send } from "lucide-react";
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
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

export interface DeliveriesProps {
  profileId: string;
  endpoint: WebhookEndpoint;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const HOUR = 60 * 60 * 1000;

// Waiting is neither good nor bad yet, so it stays neutral, as a confirming payment does.
const TONE: Record<DeliveryStatus, Tone> = {
  [DELIVERY_STATUSES.pending]: TONES.neutral,
  [DELIVERY_STATUSES.succeeded]: TONES.success,
  [DELIVERY_STATUSES.failed]: TONES.danger,
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge tone={TONE[status]}>{COPY.status[status]}</Badge>;
}

/** What the last action here did, said in place: the sheet is where it was asked for. */
type Said = { failed: boolean; text: string } | null;

// R-149: the endpoint's newest deliveries with each attempt, a resend for any one, a test event, and a resend of the
// failed ones in a window.
export function Deliveries({ profileId, endpoint }: DeliveriesProps) {
  const arg = { profileId, endpointId: endpoint.endpointId };
  // The worker sends while the sheet is open: a test event turns Delivered without a reload.
  const deliveries = useListDeliveriesQuery(arg, LIVE_QUERY);
  const [sendTest, testing] = useSendTestMutation();
  const [resendFailed, resending] = useResendFailedMutation();
  const [hours, setHours] = useState(String(DEFAULT_FAILED_SINCE_HOURS));
  const [said, setSaid] = useState<Said>(null);
  const failed = () => setSaid({ failed: true, text: COPY.errors.action });
  const test = async () => {
    setSaid(null);
    try {
      await sendTest(arg).unwrap();
      setSaid({ failed: false, text: COPY.testSent });
    } catch {
      failed();
    }
  };
  const recover = async () => {
    setSaid(null);
    try {
      const since = new Date(Date.now() - Number(hours) * HOUR).toISOString();
      const n = await resendFailed({ ...arg, since }).unwrap();
      setSaid({ failed: false, text: COPY.resentCount(n) });
    } catch {
      failed();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {endpoint.enabled ? null : (
        <p role="status" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
          {COPY.offNotice}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button
          variant={BUTTON_VARIANTS.secondary}
          loading={testing.isLoading}
          onClick={() => void test()}
          className="self-start max-sm:self-stretch"
        >
          <Send aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.sendTest}
        </Button>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SelectField
              label={COPY.since}
              value={hours}
              onValueChange={setHours}
              options={FAILED_SINCE_HOURS.map((h) => ({
                value: String(h),
                label: COPY.sinceLabels[h],
              }))}
            />
          </div>
          <Button
            variant={BUTTON_VARIANTS.secondary}
            loading={resending.isLoading}
            onClick={() => void recover()}
          >
            {COPY.resendFailed}
          </Button>
        </div>
        <p
          role="status"
          className={cx("min-h-5 text-sm", said?.failed ? "text-danger" : "text-ink")}
        >
          {said?.text}
        </p>
      </div>
      {deliveries.isError && !deliveries.currentData ? (
        <LoadError
          message={COPY.deliveriesFailed}
          retrying={deliveries.isFetching}
          onRetry={() => void deliveries.refetch()}
        />
      ) : !deliveries.currentData ? (
        <ul aria-hidden className="divide-y divide-line rounded-lg border border-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-28" />
              </span>
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-8 w-16" />
            </li>
          ))}
        </ul>
      ) : deliveries.currentData.length === 0 ? (
        <EmptyState
          compact
          icon={Send}
          title={COPY.noDeliveries}
          description={COPY.noDeliveriesBody}
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {deliveries.currentData.map((d) => (
            <DeliveryRow
              key={d.eventId}
              profileId={profileId}
              endpointId={endpoint.endpointId}
              delivery={d}
              onSaid={setSaid}
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
  onSaid,
}: {
  profileId: string;
  endpointId: string;
  delivery: Delivery;
  onSaid: (said: Said) => void;
}) {
  const [resend, resending] = useResendDeliveryMutation();
  const name = d.type === TEST_EVENT ? COPY.testEvent : COPY.eventLabels[d.type];
  const again = async () => {
    onSaid(null);
    try {
      await resend({ profileId, endpointId, eventId: d.eventId }).unwrap();
      onSaid({ failed: false, text: COPY.resent });
    } catch {
      onSaid({ failed: true, text: COPY.errors.action });
    }
  };
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {name}
            {d.invoiceId && d.number !== null ? (
              <>
                {" · "}
                <RecordLink href={`${APP_ROUTES.invoices}/${d.invoiceId}`}>
                  {invoiceNumber(d.number)}
                </RecordLink>
              </>
            ) : null}
          </span>
          <span className="block text-xs text-muted tabular-nums">
            {WHEN.format(new Date(d.createdAt))}
            {d.nextAttemptAt ? ` · ${COPY.nextTry(WHEN.format(new Date(d.nextAttemptAt)))}` : null}
          </span>
        </span>
        <DeliveryStatusBadge status={d.status} />
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
        <details className="group text-xs">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-[var(--fw-icon-sm)] transition-transform duration-[var(--fw-duration-fast)] group-open:rotate-90"
            />
            {COPY.attempts(d.attempts.length)}
          </summary>
          <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-3">
            {d.attempts.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: attempts only append, so the position names one
              <li key={i} className="flex flex-wrap gap-x-3 text-muted tabular-nums">
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
