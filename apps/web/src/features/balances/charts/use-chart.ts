"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

// Measured size rather than a scaled viewBox, so text in the SVG keeps its real size.
export function useChart(count: number, x: (index: number, width: number) => number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.clientX - event.currentTarget.getBoundingClientRect().left;
    let nearest = 0;
    for (let i = 1; i < count; i++) {
      if (Math.abs(x(i, size.width) - left) < Math.abs(x(nearest, size.width) - left)) nearest = i;
    }
    setActive(nearest);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = count - 1;
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
  };

  return {
    ref,
    ...size,
    active,
    handlers: {
      onPointerMove,
      onPointerLeave: () => setActive(null),
      onKeyDown,
      onFocus: () => setActive(count - 1),
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
