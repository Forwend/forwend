"use client";

import { STEP_STATES, type StepState } from "@forwend/ui-web";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  FINAL_STEP_STATES,
  HERO_STEP_DELAYS_MS,
  HERO_STEPS,
} from "@/screens/landing/sections/hero/constants/hero-motion";
import {
  RIVER_MARKS,
  RIVER_MARKS_COMPACT,
  RIVER_SOURCE,
  RIVER_VIEWBOX,
} from "@/screens/landing/sections/hero/constants/river";
import { HeroPayment } from "@/screens/landing/sections/hero/hero-payment";
import { HERO_IMAGE, HERO_NIGHT_IMAGE } from "@/shared/assets/images";
import { smoothPath, smoothPathShares } from "@/shared/lib/art-paths";

const RIVERS = [
  { marks: RIVER_MARKS_COMPACT, className: "lg:hidden" },
  { marks: RIVER_MARKS, className: "hidden lg:inline" },
].map((river) => ({
  ...river,
  d: smoothPath([RIVER_SOURCE, ...river.marks]),
  shares: smoothPathShares([RIVER_SOURCE, ...river.marks]),
}));

function statesAt(reached: number): StepState[] {
  return HERO_STEPS.map((_, i) =>
    i < reached ? STEP_STATES.complete : i === reached ? STEP_STATES.current : STEP_STATES.upcoming,
  );
}

// The signature moment: each payment step lights a mark on the river while the path draws forward.
export function HeroJourney() {
  // Starts with nothing lit, so the first step draws the line from the source too.
  const [states, setStates] = useState<readonly StepState[]>(statesAt(-1));
  const reached = states.filter((state) => state !== STEP_STATES.upcoming).length;
  const payment = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStates(FINAL_STEP_STATES);
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    // On phones the river and the sample invoice sit below the fold: play once they are in view, not unseen.
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.disconnect();
        timers = HERO_STEP_DELAYS_MS.map((delay, i) =>
          setTimeout(
            () => setStates(i === HERO_STEPS.length - 1 ? FINAL_STEP_STATES : statesAt(i)),
            delay,
          ),
        );
      },
      { threshold: 0.5 },
    );
    if (payment.current) seen.observe(payment.current);
    return () => {
      seen.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      {/* The art fades into the page at the bottom; below lg that happens behind the invoice panel. */}
      <div className="absolute inset-x-0 top-0 bottom-36 -z-10 overflow-hidden lg:bottom-0">
        <Image
          src={HERO_IMAGE.src}
          alt=""
          fill
          preload
          sizes="100vw"
          className="object-cover object-center dark:hidden"
        />
        {/* Same composition at night, so the river marks line up in both themes. */}
        <Image
          src={HERO_NIGHT_IMAGE.src}
          alt=""
          fill
          sizes="100vw"
          // The theme is only known in the browser, so both images start loading at once;
          // the dawn image keeps the high priority (the default theme and the Lighthouse run).
          loading="eager"
          className="hidden object-cover object-center dark:block"
        />
        {/* Soft light behind the headline and form, so text stays readable over the bright mountains. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_56%_at_50%_42%,color-mix(in_oklab,var(--fw-bg)_80%,transparent),transparent_100%)] lg:bg-[radial-gradient(ellipse_64%_52%_at_50%_36%,color-mix(in_oklab,var(--fw-bg)_78%,transparent),transparent_100%)]" />
        {/* Fades the art into the page below the river overlay, so the marks and line keep full strength. */}
        <div className="absolute inset-x-0 bottom-0 h-1/6 bg-[linear-gradient(to_bottom,transparent,var(--fw-bg))]" />
        <svg
          viewBox={`0 0 ${RIVER_VIEWBOX.width} ${RIVER_VIEWBOX.height}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
          className="absolute inset-0 h-full w-full"
        >
          {RIVERS.map(({ d, shares, className }) => (
            <path
              key={`path-${className}`}
              d={d}
              pathLength={1}
              // The line ends at the last lit mark, so it moves on the same clock as the marks.
              style={{ strokeDashoffset: 1 - (shares[reached - 1] ?? 0) }}
              className={`fw-river-path ${className}`}
            />
          ))}
          {RIVERS.map(({ marks, className }) => (
            <g key={className} className={className}>
              {marks.map(([cx, cy], i) => (
                <circle
                  key={`${cx}-${cy}`}
                  data-river-mark={i}
                  cx={cx}
                  cy={cy}
                  r={9}
                  className={i < reached ? "fw-river-mark fw-river-mark-lit" : "fw-river-mark"}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div ref={payment} className="mt-auto flex justify-center pt-12 lg:justify-end lg:pr-20">
        <HeroPayment states={states} />
      </div>
    </>
  );
}
