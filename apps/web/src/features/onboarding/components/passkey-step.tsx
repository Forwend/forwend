import { Check, Fingerprint } from "lucide-react";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";

const COPY = FIRST_RUN_COPY.passkey;

export function PasskeyLead() {
  return (
    <span className="grid size-20 place-items-center rounded-xl bg-surface-2 text-accent">
      <Fingerprint aria-hidden className="size-10" strokeWidth={1.6} />
    </span>
  );
}

/** Why a passkey helps; the frame's footer adds it or moves on. */
export function PasskeyStep() {
  return (
    <ul className="mx-auto flex w-fit flex-col gap-2.5">
      {COPY.points.map((point) => (
        <li key={point} className="flex items-center gap-2.5 text-ink">
          <Check aria-hidden className="size-4 shrink-0 text-accent" />
          {point}
        </li>
      ))}
    </ul>
  );
}
