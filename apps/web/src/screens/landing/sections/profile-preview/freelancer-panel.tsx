import {
  Money,
  PAYMENT_STATUS,
  PaymentTimeline,
  STEP_STATES,
  StatusPill,
  TokenChip,
} from "@forwend/ui-web";
import { PROFILE_TABS } from "@/screens/landing/sections/profile-preview/constants/profile-preview-content";
import { PanelLayout } from "@/screens/landing/sections/profile-preview/panel-layout";
import { SAMPLE_INVOICE, SAMPLE_STEPS } from "@/shared/examples/sample-invoice";

export function FreelancerPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.freelancer}>
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium text-ink">Invoice {SAMPLE_INVOICE.id}</p>
            <p className="text-sm text-muted">{SAMPLE_INVOICE.client} · due in 7 days</p>
          </div>
          <StatusPill status={PAYMENT_STATUS.settled} />
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-5">
          <div>
            <p className="text-sm text-muted">{SAMPLE_INVOICE.service}</p>
            <Money
              baseUnits={SAMPLE_INVOICE.baseUnits}
              decimals={SAMPLE_INVOICE.decimals}
              token={SAMPLE_INVOICE.token}
              className="mt-1 text-amount-lg text-ink"
            />
          </div>
          <TokenChip token={SAMPLE_INVOICE.token} network={SAMPLE_INVOICE.network} />
        </div>
        <div className="mt-6">
          <PaymentTimeline
            label="Sample invoice progress"
            steps={SAMPLE_STEPS.map((label, i) => ({
              label,
              state: i === SAMPLE_STEPS.length - 1 ? STEP_STATES.current : STEP_STATES.complete,
            }))}
          />
        </div>
      </div>
    </PanelLayout>
  );
}
