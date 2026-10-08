import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleDashed,
  CircleDot,
  Clock,
  RotateCcw,
} from "lucide-react";
import { encode } from "uqr";
import { ACTIVITY_DIRECTIONS } from "../constants/activity";
import { PAYMENT_STATUSES } from "../constants/payment-status";
import { STEP_STATES } from "../constants/timeline";
import { cx } from "../lib/cx";
import { formatTokenAmount } from "../lib/money";
import { TONE_CLASSES } from "../lib/tone";
import type {
  ActivityRowProps,
  MoneyProps,
  NetworkWarningProps,
  PaymentStatus,
  PaymentTimelineProps,
  QrCodeProps,
  StatTileProps,
  StatusPillProps,
  TokenChipProps,
} from "../types/payments/display";

export function Money({ baseUnits, decimals, token, fractionDigits, className }: MoneyProps) {
  return (
    <span data-money className={cx("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-mono tabular-nums tracking-tight">
        {formatTokenAmount({ baseUnits, decimals, fractionDigits })}
      </span>
      {token ? <span className="text-[0.8em] text-muted"> {token}</span> : null}
    </span>
  );
}

export function TokenChip({ token, network }: TokenChipProps) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-pill border border-line text-xs font-medium">
      <span className="bg-surface px-2.5 py-1 text-ink">{token}</span>
      <span className="border-l border-line bg-surface-2 px-2.5 py-1 text-muted">{network}</span>
    </span>
  );
}

export function QrCode({ value, label, className }: QrCodeProps) {
  const { data, size } = encode(value, { border: 4 });
  return (
    // Always dark modules on a light ground: scanners often fail on inverted codes.
    <svg
      data-theme="light"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cx("aspect-square rounded-md bg-surface", className)}
    >
      <path
        fill="var(--fw-ink)"
        d={data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join("")}
      />
    </svg>
  );
}

const STATUS_ICONS: Record<PaymentStatus, typeof Check> = {
  detected: CircleDot,
  confirming: Clock,
  paid: Check,
  partiallyPaid: CircleDashed,
  overpaid: AlertTriangle,
  expired: Clock,
  expiredPartiallyPaid: AlertTriangle,
  settled: Check,
  refundPending: RotateCcw,
  refunded: RotateCcw,
};

export function StatusPill({ status }: StatusPillProps) {
  const { label, tone } = PAYMENT_STATUSES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <span
      data-status={status}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {label}
    </span>
  );
}

export function PaymentTimeline({ steps, label }: PaymentTimelineProps) {
  return (
    <ol
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step) => (
        <li
          key={step.label}
          aria-current={step.state === STEP_STATES.current ? "step" : undefined}
          className="flex flex-col gap-2"
        >
          <span
            className={cx(
              "h-1 rounded-pill transition-colors duration-[var(--fw-duration-slow)] ease-out",
              step.state === STEP_STATES.complete && "bg-ink",
              step.state === STEP_STATES.current && "bg-accent",
              step.state === STEP_STATES.upcoming && "bg-line",
            )}
          />
          <span
            className={cx(
              "text-xs",
              step.state === STEP_STATES.upcoming ? "text-subtle" : "font-medium text-ink",
            )}
          >
            {step.label}
          </span>
          {step.detail ? (
            <span className="font-mono text-xs text-subtle">{step.detail}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function StatTile({ label, value, note }: StatTileProps) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xl text-ink">{value}</p>
      {note ? <p className="mt-1 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}

export function ActivityRow({ title, detail, direction, amount, status }: ActivityRowProps) {
  const incoming = direction === ACTIVITY_DIRECTIONS.incoming;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="flex items-center gap-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-surface-2 text-muted">
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{title}</span>
        <span className="block truncate text-sm text-muted">{detail}</span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={incoming ? "text-success" : "text-ink"}>
          {incoming ? "+" : "−"}
          <Money {...amount} />
        </span>
        <StatusPill status={status} />
      </span>
    </div>
  );
}

export function NetworkWarning({ network, token }: NetworkWarningProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-transparent bg-warning-soft p-4 text-sm text-warning"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-[var(--fw-icon-md)] shrink-0" />
      <p>
        Send only <strong>{token}</strong> on <strong>{network}</strong>. Sending another token or
        using another network may make the funds unrecoverable.
      </p>
    </div>
  );
}
