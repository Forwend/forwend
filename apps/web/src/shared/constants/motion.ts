/** A part a step puts on screen rises a little and fades in; what it replaced goes at
 * once. Tailwind's translate-y sets `translate`, so that is the property that transitions. */
export const ENTER =
  "transition-[opacity,translate] duration-[var(--fw-duration-base)] ease-out starting:translate-y-1 starting:opacity-0";
