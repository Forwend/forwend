import { IconButton, Tooltip } from "@forwend/ui-web";
import { Info } from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";

export function EstimateHint() {
  return (
    <Tooltip content={BALANCES_COPY.estimateHint}>
      <IconButton label={BALANCES_COPY.estimateHint} size="xs" className="self-center">
        <Info aria-hidden className="size-[var(--fw-icon-sm)]" />
      </IconButton>
    </Tooltip>
  );
}
