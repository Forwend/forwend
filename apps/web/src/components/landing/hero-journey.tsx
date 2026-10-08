"use client";

import type { StepState } from "@forwend/ui-web";
import { STEP_STATES } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { FINAL_STEP_STATES, HERO_STEP_DELAYS_MS, HERO_STEPS } from "@/constants/hero-motion";
import { RIVER_MARKS, RIVER_PATH } from "@/constants/river";
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
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 -z-10 h-full w-full"
      >
        <path d={RIVER_PATH} pathLength={1} className="fw-river-path" />
        {RIVER_MARKS.map(([cx, cy], i) => {
          const lit = states[i] !== STEP_STATES.upcoming;
          return (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={lit ? 9 : 6}
              className={lit ? "fw-river-mark fw-river-mark-lit" : "fw-river-mark"}
            />
          );
        })}
      </svg>
      <div className="mt-auto flex justify-center pt-12 lg:justify-end lg:pr-[6%]">
        <HeroPayment states={states} />
      </div>
    </>
  );
}
