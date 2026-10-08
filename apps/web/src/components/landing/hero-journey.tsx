"use client";

import type { StepState } from "@forwend/ui-web";
import { STEP_STATES } from "@forwend/ui-web";
import Image from "next/image";
import { useEffect, useState } from "react";
import { FINAL_STEP_STATES, HERO_STEP_DELAYS_MS, HERO_STEPS } from "@/constants/hero-motion";
import { HERO_IMAGE, HERO_NIGHT_IMAGE } from "@/constants/landing-images";
import { RIVER_MARKS, RIVER_MARKS_COMPACT, RIVER_SOURCE, RIVER_VIEWBOX } from "@/constants/river";
import { smoothPath } from "@/lib/art";
import { HeroPayment } from "./hero-payment";

function statesAt(reached: number): StepState[] {
  return HERO_STEPS.map((_, i) =>
    i < reached ? STEP_STATES.complete : i === reached ? STEP_STATES.current : STEP_STATES.upcoming,
  );
}

// The signature moment: each payment step lights a mark on the river while the path draws forward.
export function HeroJourney() {
  const [states, setStates] = useState<readonly StepState[]>(statesAt(0));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStates(FINAL_STEP_STATES);
      return;
    }
    const timers = HERO_STEP_DELAYS_MS.map((delay, i) =>
      setTimeout(
        () => setStates(i === HERO_STEPS.length - 1 ? FINAL_STEP_STATES : statesAt(i)),
        delay,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <>
      {/* The art fades into the page at the bottom; below lg that happens behind the invoice panel. */}
      <div className="absolute inset-x-0 top-0 bottom-36 -z-10 overflow-hidden lg:bottom-0">
        <Image
          src={HERO_IMAGE.src}
          alt=""
          fill
          priority
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
          {[
            { marks: RIVER_MARKS_COMPACT, className: "lg:hidden" },
            { marks: RIVER_MARKS, className: "hidden lg:inline" },
          ].map(({ marks, className }) => (
            <path
              key={`path-${className}`}
              d={smoothPath([RIVER_SOURCE, ...marks])}
              pathLength={1}
              className={`fw-river-path ${className}`}
            />
          ))}
          {[
            { marks: RIVER_MARKS_COMPACT, className: "lg:hidden" },
            { marks: RIVER_MARKS, className: "hidden lg:inline" },
          ].map(({ marks, className }) => (
            <g key={className} className={className}>
              {marks.map(([cx, cy], i) => {
                const lit = states[i] !== STEP_STATES.upcoming;
                return (
                  <circle
                    key={`${cx}-${cy}`}
                    data-river-mark={i}
                    cx={cx}
                    cy={cy}
                    r={lit ? 9 : 6}
                    className={lit ? "fw-river-mark fw-river-mark-lit" : "fw-river-mark"}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-auto flex justify-center pt-12 lg:justify-end lg:pr-20">
        <HeroPayment states={states} />
      </div>
    </>
  );
}
