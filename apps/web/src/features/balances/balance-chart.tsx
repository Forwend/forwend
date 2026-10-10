"use client";

import { useId } from "react";
import type { HistorySeries } from "@/features/balances/balance-history";
import { formatUsd, USD, USD_DECIMALS } from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { niceTop, toNumber, useChart } from "@/features/balances/use-chart";

// Points are the ends of UTC days (00:00 of the next day); a point is labeled with the day it closes. The last is now.
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const DAY_MS = 86_400_000;

export function dayLabel(series: HistorySeries, index: number): string {
  if (index === series.dates.length - 1) return BALANCES_COPY.today;
  const date = series.dates[index];
  return date ? DAY.format(new Date(date.getTime() - DAY_MS / 2)) : "";
}

export function amountLabel(series: HistorySeries, index: number): string {
  return `${formatUsd(series.values[index] ?? 0n)} ${USD}`;
}

const PAD = { top: 12, right: 8, bottom: 28, left: 52 } as const;
const PAD_COMPACT = { top: 6, right: 6, bottom: 6, left: 6 } as const;

export function BalanceChart({
  series,
  label,
  compact = false,
  className,
}: {
  series: HistorySeries;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  const pad = compact ? PAD_COMPACT : PAD;
  const count = series.values.length;
  const x = (i: number, width: number) =>
    pad.left + (count < 2 ? 0 : (i / (count - 1)) * (width - pad.left - pad.right));
  const chart = useChart(count, x);
  const { width, height, active } = chart;

  const numbers = series.values.map((v) => toNumber(v, USD_DECIMALS));
  // From 0, so the line's height is the real amount; an empty wallet draws along the bottom.
  const top = niceTop(Math.max(...numbers, 0));
  const y = (n: number) => pad.top + (1 - n / top) * (height - pad.top - pad.bottom);
  const points = numbers.map((n, i) => `${x(i, width).toFixed(1)},${y(n).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  const base = (height - pad.bottom).toFixed(1);
  const area = `${line}L${x(count - 1, width).toFixed(1)},${base}L${x(0, width).toFixed(1)},${base}Z`;
  const ticks = [0, top / 2, top];
  const dates = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1];
  const point = active ?? null;
  const pointX = point === null ? 0 : x(point, width);

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
          className="block rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          {...chart.handlers}
        >
          <defs>
            <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--fw-ink)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--fw-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {compact
            ? null
            : ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={pad.left}
                    x2={width - pad.right}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--fw-line-strong)"
                    strokeOpacity="0.45"
                  />
                  <text
                    x={pad.left - 10}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    stroke="var(--fw-surface)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeOpacity="0.8"
                    paintOrder="stroke"
                    className="fill-muted font-mono text-2xs tabular-nums"
                  >
                    {COMPACT.format(t)}
                  </text>
                </g>
              ))}
          {compact
            ? null
            : dates.map((i, n) => (
                <text
                  key={i}
                  x={x(i, width)}
                  y={height - 8}
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
          <path d={area} fill={`url(#${id}-wash)`} />
          <path
            d={line}
            fill="none"
            stroke="var(--fw-ink)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {point === null ? (
            <circle
              cx={x(count - 1, width)}
              cy={y(numbers[count - 1] ?? 0)}
              r="4"
              fill="var(--fw-accent)"
              stroke="var(--fw-surface)"
              strokeWidth="2"
            />
          ) : (
            <g>
              <line
                x1={pointX}
                x2={pointX}
                y1={pad.top}
                y2={height - pad.bottom}
                stroke="var(--fw-ink)"
                strokeOpacity="0.35"
              />
              <circle
                cx={pointX}
                cy={y(numbers[point] ?? 0)}
                r="5"
                fill="var(--fw-accent)"
                stroke="var(--fw-surface)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
      ) : null}
      <ChartReadout series={series} label={label} active={point} left={pointX} width={width} />
    </div>
  );
}

export function ChartReadout({
  series,
  label,
  active,
  left,
  width,
}: {
  series: HistorySeries;
  label: string;
  active: number | null;
  left: number;
  width: number;
}) {
  return (
    <>
      {active === null ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3 py-2 shadow-md"
          style={{ left: Math.min(Math.max(left, 80), width - 80), transform: "translateX(-50%)" }}
        >
          <span className="font-mono text-sm font-medium whitespace-nowrap text-ink tabular-nums">
            {amountLabel(series, active)}
          </span>
          <span className="text-xs text-muted">{dayLabel(series, active)}</span>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {active === null ? "" : `${dayLabel(series, active)}: ${amountLabel(series, active)}`}
      </p>
      {/* sr-only on the table itself does not hold: a table grows to its rows, and a year of rows ran far below the
          page, leaving an empty area to scroll through. A block wrapper clips it. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {series.values.map((_, i) => (
              <tr key={series.dates[i]?.toISOString() ?? i}>
                <th scope="row">{dayLabel(series, i)}</th>
                <td>{amountLabel(series, i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
