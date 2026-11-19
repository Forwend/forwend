"use client";

import { memo, useId } from "react";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { useChart } from "@/features/balances/hooks/use-chart";
import { formatUsd } from "@/features/balances/lib/balances";
import { smoothPath, toNumber } from "@/features/balances/lib/chart";
import type { HistorySeries } from "@/features/balances/types/balance-history";
import { MONEY_COPY } from "@/shared/constants/money-copy";

// A point is the end of a UTC day (00:00 the next day), labeled with the day it closes.
const DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DAY_MS = 86_400_000;

function dayLabel(series: HistorySeries, index: number): string {
  if (index === series.dates.length - 1) return BALANCES_COPY.today;
  const date = series.dates[index];
  return date ? DAY.format(new Date(date.getTime() - DAY_MS / 2)) : "";
}

function amountLabel(series: HistorySeries, index: number): string {
  return `${formatUsd(series.values[index] ?? 0n)} ${MONEY_COPY.usd}`;
}

const PAD = { top: 16, right: 10, bottom: 28, left: 10 } as const;
const PAD_COMPACT = { top: 14, right: 8, bottom: 22, left: 8 } as const;
const HEADROOM = 1.12;

export interface BalanceChartProps {
  series: HistorySeries;
  label: string;
  compact?: boolean;
  className?: string;
  readoutNote?: (index: number) => string;
}

export function BalanceChart({
  series,
  label,
  compact = false,
  className,
  readoutNote,
}: BalanceChartProps) {
  const id = useId();
  const pad = compact ? PAD_COMPACT : PAD;
  const count = series.values.length;
  const x = (i: number, width: number) =>
    pad.left + (count < 2 ? 0 : (i / (count - 1)) * (width - pad.left - pad.right));
  const chart = useChart((width) => series.values.map((_, i) => x(i, width)));
  const { width, height, active } = chart;

  const numbers = series.values.map((v) => toNumber(v, USD_DECIMALS));
  // From 0, so the line's height is the real amount.
  const top = Math.max(...numbers, 0) * HEADROOM || 1;
  const y = (n: number) => pad.top + (1 - n / top) * (height - pad.top - pad.bottom);
  const line = smoothPath(numbers.map((n, i) => [x(i, width), y(n)] as const));
  const base = (height - pad.bottom).toFixed(1);
  const area = `${line}L${x(count - 1, width).toFixed(1)},${base}L${x(0, width).toFixed(1)},${base}Z`;
  const dates =
    count > 2 && !compact ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1];
  const point = active ?? null;
  const pointX = point === null ? 0 : x(point, width);
  const pointY = point === null ? 0 : y(numbers[point] ?? 0);
  const lastX = x(count - 1, width);
  const lastY = y(numbers[count - 1] ?? 0);

  return (
    <div ref={chart.ref} className={`relative ${className ?? ""}`}>
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move the readout across the days
          tabIndex={0}
          role="img"
          aria-label={`${label}. ${BALANCES_COPY.chartKeys}`}
          className="absolute inset-0 block touch-pan-y overflow-visible rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          {...chart.handlers}
        >
          <defs>
            <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--fw-ink)" stopOpacity="0.16" />
              <stop offset="70%" stopColor="var(--fw-ink)" stopOpacity="0.03" />
              <stop offset="100%" stopColor="var(--fw-ink)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}-past`}>
              <rect x="0" y="0" width={point === null ? width : pointX} height={height} />
            </clipPath>
          </defs>
          {dates.map((i, n) => (
            <text
              key={i}
              x={x(i, width)}
              y={height - (compact ? 4 : 6)}
              textAnchor={n === 0 ? "start" : n === dates.length - 1 ? "end" : "middle"}
              stroke="var(--fw-surface)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeOpacity="0.8"
              paintOrder="stroke"
              className="fill-muted text-2xs"
            >
              {dayLabel(series, i)}
            </text>
          ))}
          <path
            d={area}
            fill={`url(#${id}-wash)`}
            className="motion-safe:animate-[fw-fade-in_var(--fw-duration-slower)_var(--fw-ease-out)_both]"
          />
          {point === null ? null : (
            <path
              d={line}
              fill="none"
              stroke="var(--fw-ink)"
              strokeOpacity="0.22"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          <path
            d={line}
            pathLength={1}
            clipPath={`url(#${id}-past)`}
            fill="none"
            stroke="var(--fw-ink)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="1"
            className="motion-safe:animate-[fw-draw-in_calc(var(--fw-duration-slower)*1.3)_var(--fw-ease-out)_both]"
          />
          {point === null ? (
            <g>
              <circle
                cx={lastX}
                cy={lastY}
                r="4"
                fill="var(--fw-accent)"
                style={{ transformOrigin: `${lastX}px ${lastY}px` }}
                className="motion-safe:animate-[fw-halo_2.4s_var(--fw-ease-out)_1.2s_infinite]"
              />
              <circle
                cx={lastX}
                cy={lastY}
                r="4"
                fill="var(--fw-accent)"
                stroke="var(--fw-surface)"
                strokeWidth="2"
              />
            </g>
          ) : (
            <g>
              <line
                x1={pointX}
                x2={pointX}
                y1={pointY}
                y2={height - pad.bottom}
                stroke="var(--fw-ink)"
                strokeOpacity="0.28"
                strokeDasharray="2 3"
              />
              <circle cx={pointX} cy={pointY} r="9" fill="var(--fw-accent)" fillOpacity="0.16" />
              <circle
                cx={pointX}
                cy={pointY}
                r="4.5"
                fill="var(--fw-accent)"
                stroke="var(--fw-surface)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
      ) : null}
      <ChartReadout
        series={series}
        label={label}
        active={point}
        announce={chart.announce}
        left={pointX}
        top={pointY}
        width={width}
        note={readoutNote}
      />
    </div>
  );
}

interface ChartReadoutProps {
  series: HistorySeries;
  label: string;
  active: number | null;
  announce: boolean;
  left: number;
  top?: number;
  width: number;
  note?: (index: number) => string;
}

function ChartReadout({
  series,
  label,
  active,
  announce,
  left,
  top = 0,
  width,
  note,
}: ChartReadoutProps) {
  return (
    <>
      {active === null ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-10 flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 shadow-lg transition-transform duration-[var(--fw-duration-fast)] ease-[var(--fw-ease-out)] motion-safe:animate-[fw-fade-in_var(--fw-duration-fast)_var(--fw-ease-out)]"
          style={{
            transform: `translate(clamp(0px, calc(${left}px - 50%), calc(${width}px - 100%)), max(-0.5rem, calc(${top}px - 100% - 0.875rem)))`,
          }}
        >
          <span className="text-sm font-medium whitespace-nowrap text-ink tabular-nums">
            {amountLabel(series, active)}
          </span>
          {note ? <span className="text-xs text-ink">{note(active)}</span> : null}
          <span className="text-xs text-muted">{dayLabel(series, active)}</span>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {active === null || !announce
          ? ""
          : `${dayLabel(series, active)}: ${amountLabel(series, active)}${note ? `, ${note(active)}` : ""}`}
      </p>
      <ChartTable series={series} label={label} note={note} />
    </>
  );
}

const ChartTable = memo(function ChartTable({
  series,
  label,
  note,
}: Pick<ChartReadoutProps, "series" | "label" | "note">) {
  return (
    // A wrapper, because sr-only on a table doesn't clip it.
    <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <tbody>
          {series.values.map((_, i) => (
            <tr key={series.dates[i]?.toISOString() ?? i}>
              <th scope="row">{dayLabel(series, i)}</th>
              <td>
                {amountLabel(series, i)}
                {note ? `, ${note(i)}` : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
