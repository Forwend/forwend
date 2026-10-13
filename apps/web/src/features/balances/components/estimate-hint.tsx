import { Tooltip } from "@forwend/ui-web";
import { Info } from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";

export function EstimateHint() {
  return (
    <Tooltip content={BALANCES_COPY.estimateHint}>
      <button
        type="button"
        aria-label={BALANCES_COPY.estimateHint}
        className="grid size-6 place-items-center self-center rounded-pill text-subtle outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Info aria-hidden className="size-[var(--fw-icon-sm)]" />
      </button>
    </Tooltip>
  );
}
