import { Badge, TONES } from "@forwend/ui-web";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";

/** Beside the checkout's logo in test mode (R-143): its tokens have no value. */
export function TestnetBadge() {
  return (
    <span title={COPY.testnetHint} className="inline-flex">
      <Badge tone={TONES.warning}>{COPY.testnet}</Badge>
    </span>
  );
}
