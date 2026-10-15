"use client";

import { ChartReadout, DAY, dayLabel } from "@/features/balances/components/charts/balance-chart";
import { GROUPINGS } from "@/features/balances/constants/balance-history";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { useChart } from "@/features/balances/hooks/use-chart";
import { groupSeries } from "@/features/balances/lib/balance-history";
import { toNumber } from "@/features/balances/lib/chart";
import type { Grouping, HistorySeries } from "@/features/balances/types/balance-history";

// No value axis and no grid: each bar stands on a faint track, and the readout gives the exact amount.
const PAD = { top: 12, right: 4, bottom: 28, left: 4 } as const;
const BAR_MAX = 22;
const BAR_GAP = 3;
const BAR_MIN_HEIGHT = 3;
// Tracks only where bars are wide enough to read as columns.
const TRACK_MIN = 6;
const HEADROOM = 1.08;
// The bars rise one after another, within about a third of a second in all.
const STAGGER_MS = 320;
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

export interface ReceivedChartProps {
  series: HistorySeries;
  label: string;
  className?: string;
}

export function ReceivedChart({ series, label, className }: ReceivedChartProps) {
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
  const top = Math.max(...numbers, 0) * HEADROOM || 1;
  const plot = height - PAD.top - PAD.bottom;
  const bar = Math.max(1, Math.min(BAR_MAX, slot(width, count) - BAR_GAP));
  const baseY = PAD.top + plot;
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
          {dates.map((i, n) => (
            <text
              key={i}
              x={x(i, width, count)}
              y={height - 6}
              textAnchor={n === 0 ? "start" : n === dates.length - 1 ? "end" : "middle"}
              className="fill-muted text-2xs"
            >
              {dateLabel(i, false)}
            </text>
          ))}
          {numbers.map((n, i) => {
            const left = x(i, width, count) - bar / 2;
            const key = shown.dates[i]?.toISOString() ?? i;
            const on = i === active;
            // A small amount next to a large one still shows as a bar.
            const h = n > 0 ? Math.max(BAR_MIN_HEIGHT, (n / top) * plot) : 0;
            return (
              <g key={key}>
                {bar >= TRACK_MIN ? (
                  <rect
                    x={left}
                    y={PAD.top}
                    width={bar}
                    height={plot}
                    rx={bar / 2}
                    fill="var(--fw-ink)"
                    fillOpacity={on ? 0.06 : 0.025}
                  />
                ) : null}
                {h > 0 ? (
                  <rect
                    x={left}
                    y={baseY - h}
                    width={bar}
                    height={h}
                    rx={Math.min(bar / 2, h / 2)}
                    fill={on ? "var(--fw-accent)" : "var(--fw-ink)"}
                    fillOpacity={active === null || on ? 0.88 : 0.3}
                    style={{
                      transformOrigin: `0 ${baseY}px`,
                      animationDelay: `${Math.round((i / Math.max(count - 1, 1)) * STAGGER_MS)}ms`,
                    }}
                    className="transition-[fill,fill-opacity] duration-[var(--fw-duration-fast)] motion-safe:animate-[fw-grow-y_var(--fw-duration-slow)_var(--fw-ease-out)_both]"
                  />
                ) : null}
              </g>
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
        top={
          active === null
            ? 0
            : baseY - Math.max(BAR_MIN_HEIGHT, ((numbers[active] ?? 0) / top) * plot)
        }
        width={width}
        dateLabel={(i) => dateLabel(i, true)}
      />
    </div>
  );
}
