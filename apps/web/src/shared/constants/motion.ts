/** A step's new part rises and fades in; Tailwind's translate-y sets `translate`, so that transitions. */
export const ENTER =
  "transition-[opacity,translate] duration-[var(--fw-duration-base)] ease-out starting:translate-y-1 starting:opacity-0";

/** Only a fade: a rise would move what sits under the part. */
export const FADE_IN =
  "motion-safe:animate-[fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)]";

export const STEP_IN =
  "motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]";
