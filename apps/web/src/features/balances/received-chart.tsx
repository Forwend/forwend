"use client";

import { ChartReadout, dayLabel } from "@/features/balances/balance-chart";
import type { HistorySeries } from "@/features/balances/balance-history";
import { USD_DECIMALS } from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { niceTop, toNumber, useChart } from "@/features/balances/use-chart";

const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const PAD = { top: 12, right: 4, bottom: 28, left: 52 } as const;
const BAR_MAX = 24;
const BAR_GAP = 2;
const BAR_RADIUS = 4;

export function ReceivedChart({
  series,
  label,
  className,
}: {
  series: HistorySeries;
  label: string;
  className?: string;
}) {
  const count = series.values.length;
  const slot = (width: number) => (width - PAD.left - PAD.right) / Math.max(count, 1);
  const x = (i: number, width: number) => PAD.left + slot(width) * (i + 0.5);
  const chart = useChart(count, x);
  const { width, height, active } = chart;

  const numbers = series.values.map((v) => toNumber(v, USD_DECIMALS));
  const top = niceTop(Math.max(...numbers, 0));
  const plot = height - PAD.top - PAD.bottom;
  const bar = Math.max(1, Math.min(BAR_MAX, slot(width) - BAR_GAP));
  const ticks = [0, top / 2, top];
  const dates = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1];

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
          {ticks.map((t) => {
            const ty = PAD.top + (1 - t / top) * plot;
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={ty}
                  y2={ty}
                  stroke="var(--fw-line)"
                />
                <text
                  x={PAD.left - 10}
                  y={ty}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted font-mono text-2xs tabular-nums"
                >
                  {COMPACT.format(t)}
                </text>
              </g>
            );
          })}
          {dates.map((i, n) => (
            <text
              key={i}
              x={x(i, width)}
              y={height - 8}
              textAnchor={n === 0 ? "start" : n === dates.length - 1 ? "end" : "middle"}
              className="fill-muted text-2xs"
            >
              {dayLabel(series, i)}
            </text>
          ))}
          {numbers.map((n, i) => {
            const h = (n / top) * plot;
            if (h <= 0) return null;
            const left = x(i, width) - bar / 2;
            const r = Math.min(BAR_RADIUS, bar / 2, h);
            const baseY = PAD.top + plot;
            const d = `M${left},${baseY}V${baseY - h + r}Q${left},${baseY - h} ${left + r},${baseY - h}H${left + bar - r}Q${left + bar},${baseY - h} ${left + bar},${baseY - h + r}V${baseY}Z`;
            return (
              <path
                key={series.dates[i]?.toISOString() ?? i}
                d={d}
                fill={i === active ? "var(--fw-accent)" : "var(--fw-ink)"}
                fillOpacity={active === null || i === active ? 0.85 : 0.35}
              />
            );
          })}
        </svg>
      ) : null}
      <ChartReadout
        series={series}
        label={label}
        active={active}
        left={active === null ? 0 : x(active, width)}
        width={width}
      />
    </div>
  );
}
