"use client";

import {
  GROUPINGS,
  type Grouping,
  groupSeries,
  type HistorySeries,
} from "@/features/balances/balance-history";
import { USD_DECIMALS } from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { ChartReadout, COMPACT, DAY, dayLabel } from "@/features/balances/charts/balance-chart";
import { niceTop, toNumber, useChart } from "@/features/balances/charts/use-chart";

const PAD = { top: 12, right: 4, bottom: 28, left: 52 } as const;
const BAR_MAX = 24;
const BAR_GAP = 2;
const BAR_RADIUS = 4;
const BAR_MIN_HEIGHT = 2;
// Under this many pixels a day's bar cannot be told apart or pointed at, so days add up into weeks (3M) or months (1Y).
const SLOT_MIN = 4;
const WEEKS_MAX_DAYS = 120;
const MONTH_AXIS = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const slot = (width: number, count: number) => (width - PAD.left - PAD.right) / Math.max(count, 1);
const x = (i: number, width: number, count: number) => PAD.left + slot(width, count) * (i + 0.5);

function shownSeries(series: HistorySeries, width: number): [HistorySeries, Grouping | null] {
  const days = series.values.length;
  if (width === 0 || slot(width, days) >= SLOT_MIN) return [series, null];
  const by = days > WEEKS_MAX_DAYS ? GROUPINGS.month : GROUPINGS.week;
  return [groupSeries(series, by), by];
}

export function ReceivedChart({
  series,
  label,
  className,
}: {
  series: HistorySeries;
  label: string;
  className?: string;
}) {
  const chart = useChart((width) => {
    const count = shownSeries(series, width)[0].values.length;
    return Array.from({ length: count }, (_, i) => x(i, width, count));
  });
  const { width, height } = chart;
  const [shown, by] = shownSeries(series, width);
  const count = shown.values.length;
  // A resize can regroup the bars under a chosen one.
  const active = chart.active !== null && chart.active < count ? chart.active : null;

  const numbers = shown.values.map((v) => toNumber(v, USD_DECIMALS));
  const top = niceTop(Math.max(...numbers, 0));
  const plot = height - PAD.top - PAD.bottom;
  const bar = Math.max(1, Math.min(BAR_MAX, slot(width, count) - BAR_GAP));
  const ticks = [0, top / 2, top];
  const dates = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1];

  const dateLabel = (i: number, long: boolean) => {
    const start = shown.dates[i];
    if (by === null || !start) return dayLabel(shown, i);
    if (by === GROUPINGS.week)
      return long ? BALANCES_COPY.weekOf(DAY.format(start)) : DAY.format(start);
    return (long ? MONTH : MONTH_AXIS).format(start);
  };

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
          className="absolute inset-0 block touch-pan-y rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
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
              x={x(i, width, count)}
              y={height - 8}
              textAnchor={n === 0 ? "start" : n === dates.length - 1 ? "end" : "middle"}
              className="fill-muted text-2xs"
            >
              {dateLabel(i, false)}
            </text>
          ))}
          {numbers.map((n, i) => {
            if (n <= 0) return null;
            // A small amount next to a large one still shows as a bar.
            const h = Math.max(BAR_MIN_HEIGHT, (n / top) * plot);
            const left = x(i, width, count) - bar / 2;
            const r = Math.min(BAR_RADIUS, bar / 2, h);
            const baseY = PAD.top + plot;
            const d = `M${left},${baseY}V${baseY - h + r}Q${left},${baseY - h} ${left + r},${baseY - h}H${left + bar - r}Q${left + bar},${baseY - h} ${left + bar},${baseY - h + r}V${baseY}Z`;
            return (
              <path
                key={shown.dates[i]?.toISOString() ?? i}
                d={d}
                fill={i === active ? "var(--fw-accent)" : "var(--fw-ink)"}
                fillOpacity={active === null || i === active ? 0.85 : 0.35}
              />
            );
          })}
        </svg>
      ) : null}
      <ChartReadout
        series={shown}
        label={label}
        active={active}
        announce={chart.announce}
        left={active === null ? 0 : x(active, width, count)}
        width={width}
        dateLabel={(i) => dateLabel(i, true)}
      />
    </div>
  );
}
