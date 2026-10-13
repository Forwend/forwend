"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

// Measured size rather than a scaled viewBox, so text in the SVG keeps its real size. `points` gives each point's x
// for a width; a chart may group its points by width, so their count can change with it.
export function useChart(points: (width: number) => number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<number | null>(null);
  // Only keyboard moves are announced; a pointer sweeping across the days would read out every one.
  const [byKey, setByKey] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const xs = points(size.width);
    let nearest = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs((xs[i] ?? 0) - left) < Math.abs((xs[nearest] ?? 0) - left)) nearest = i;
    }
    setActive(nearest);
    setByKey(false);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = points(size.width).length - 1;
    const now = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, now - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, now + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    setByKey(true);
  };

  return {
    ref,
    ...size,
    active,
    announce: byKey,
    handlers: {
      // A tap shows the readout and a drag scrubs it; on touch it stays after the finger lifts.
      onPointerDown: onPointer,
      onPointerMove: onPointer,
      onPointerLeave: (event: PointerEvent<SVGSVGElement>) => {
        if (event.pointerType === "mouse") setActive(null);
      },
      onPointerCancel: () => setActive(null),
      onKeyDown,
      // A press focuses the chart after pointerdown chose a point; keep that point.
      onFocus: () => setActive((now) => now ?? points(size.width).length - 1),
      onBlur: () => setActive(null),
    },
  };
}

export function niceTop(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((n) => n * power >= max) ?? 10;
  return step * power;
}

/** Geometry only: a pixel position for an exact amount. Shown amounts are always formatted from the bigint. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}
