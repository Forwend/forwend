import { STEP_STATES } from "@forwend/ui-web";

// Each gap must exceed --fw-duration-slow, so the river line reaches a mark before the next one lights.
export const HERO_STEP_DELAYS_MS = [700, 1700, 2800, 3800] as const;

export const HERO_STEPS = ["Detected", "Confirming", "Paid", "Settled"] as const;

export const FINAL_STEP_STATES = [
  STEP_STATES.complete,
  STEP_STATES.complete,
  STEP_STATES.complete,
  STEP_STATES.current,
] as const;
