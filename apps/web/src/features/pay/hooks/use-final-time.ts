import { useRef } from "react";
import { timeOfDay } from "@/shared/lib/dates";

export function useFinalTime(confirming: boolean, secondsLeft: number, readAt: number | null) {
  // Count from the read that first gave secondsLeft, or the time creeps later with every poll.
  const seen = useRef({ seconds: -1, at: 0 });
  if (readAt !== null && seen.current.seconds !== secondsLeft)
    seen.current = { seconds: secondsLeft, at: readAt };
  return confirming && readAt !== null && secondsLeft > 0
    ? timeOfDay(new Date(seen.current.at + secondsLeft * 1000).toISOString())
    : null;
}
