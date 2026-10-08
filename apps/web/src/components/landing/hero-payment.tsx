import {
  Badge,
  Money,
  PANEL_TONES,
  Panel,
  PaymentTimeline,
  STEP_STATES,
  TokenChip,
} from "@forwend/ui-web";
import { HERO_STEPS } from "@/constants/hero-motion";
import { SAMPLE_INVOICE } from "@/constants/sample-invoice";
import type { HeroPaymentProps } from "@/types/landing/props";

const shortHash = `${SAMPLE_INVOICE.txHash.slice(0, 6)}…${SAMPLE_INVOICE.txHash.slice(-4)}`;

export function HeroPayment({ states }: HeroPaymentProps) {
  const settled = states[HERO_STEPS.length - 1] === STEP_STATES.current;
  return (
    <Panel tone={PANEL_TONES.glass} className="w-full max-w-md p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Invoice {SAMPLE_INVOICE.id}</span>
        <Badge>Sample</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        {SAMPLE_INVOICE.client} · {SAMPLE_INVOICE.service}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Money
          baseUnits={SAMPLE_INVOICE.baseUnits}
          decimals={SAMPLE_INVOICE.decimals}
          className="text-amount text-ink"
        />
        <TokenChip token={SAMPLE_INVOICE.token} network={SAMPLE_INVOICE.network} />
      </div>
      <div className="mt-5">
        <PaymentTimeline
          label="Sample payment progress"
          steps={HERO_STEPS.map((label, i) => ({
            label,
            state: states[i] ?? STEP_STATES.upcoming,
          }))}
        />
      </div>
      <p className="mt-4 font-mono text-2xs text-muted sm:text-xs" aria-live="polite">
        {settled
          ? `Tx ${shortHash} · settled to your wallet`
          : "Waiting for network confirmations…"}
      </p>
    </Panel>
  );
}
