import { useRef } from "react";

const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** When a confirming payment is final, as a clock time; null while not confirming or unknown. */
export function useFinalTime(confirming: boolean, secondsLeft: number, readAt: number | null) {
  // secondsLeft changes only when the network's final block moves, every few minutes; each poll reads it again. So
  // count from the read that first gave this value, or the time would creep later with every poll, then jump back.
  const seen = useRef({ seconds: -1, at: 0 });
  if (readAt !== null && seen.current.seconds !== secondsLeft)
    seen.current = { seconds: secondsLeft, at: readAt };
  return confirming && readAt !== null && secondsLeft > 0
    ? CLOCK.format(seen.current.at + secondsLeft * 1000)
    : null;
}
