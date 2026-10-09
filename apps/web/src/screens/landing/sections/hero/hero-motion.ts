import { STEP_STATES } from "@forwend/ui-web";

// When each sample payment step lights up after load, in ms. Matches the river draw in globals.css.
export const HERO_STEP_DELAYS_MS = [700, 1700, 2800, 3800] as const;

export const HERO_STEPS = ["Detected", "Confirming", "Paid", "Settled"] as const;

export const FINAL_STEP_STATES = [
  STEP_STATES.complete,
  STEP_STATES.complete,
  STEP_STATES.complete,
  STEP_STATES.current,
] as const;
