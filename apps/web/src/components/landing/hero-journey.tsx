"use client";

import type { StepState } from "@forwend/ui-web";
import { STEP_STATES } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { DawnLandscape } from "@/components/art/dawn-landscape";
import { FINAL_STEP_STATES, HERO_STEP_DELAYS_MS, HERO_STEPS } from "@/constants/hero-motion";
import { RIVER_MARKS, RIVER_MARKS_COMPACT, RIVER_PATH } from "@/constants/river";
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
      {/* Below lg the art stops partway down the panel, so the panel covers its bottom edge. */}
      <div className="absolute inset-x-0 top-0 bottom-36 -z-10 overflow-hidden rounded-xl lg:bottom-0">
        <DawnLandscape className="absolute inset-0 h-full w-full" />
        <svg
          viewBox="0 0 1600 1000"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
          className="absolute inset-0 h-full w-full"
        >
          <path d={RIVER_PATH} pathLength={1} className="fw-river-path" />
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
      <div className="mt-auto flex justify-center pt-12 lg:justify-end lg:pr-[6%]">
        <HeroPayment states={states} />
      </div>
    </>
  );
}
