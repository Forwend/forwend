import {
  ActivityRow,
  Badge,
  CodeBlock,
  Money,
  PAYMENT_STATUS,
  PaymentTimeline,
  STEP_STATES,
  StatTile,
  StatusPill,
  TokenChip,
} from "@forwend/ui-web";
import { DEVELOPERS, PROFILE_TABS, PROFILES } from "@/constants/landing";
import {
  SAMPLE_BALANCES,
  SAMPLE_EVENTS,
  SAMPLE_PERSONAL_ACTIVITY,
  SAMPLE_STORE_ACTIVITY,
} from "@/constants/landing-samples";
import { SAMPLE_INVOICE, SAMPLE_STEPS } from "@/constants/sample-invoice";
import type { ProfilePanelLayoutProps } from "@/types/landing/props";

function PanelLayout({ tab, children }: ProfilePanelLayoutProps) {
  const copy = PROFILES.tabs[tab];
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
      <div>
        <h3 className="text-2xl font-semibold text-ink">{copy.title}</h3>
        <p className="mt-3 max-w-md text-lg text-muted">{copy.body}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-2 p-3 sm:p-4">
        <div className="mb-3 flex justify-end">
          <Badge>Sample</Badge>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PersonalPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.personal}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Available"
          value={<Money {...SAMPLE_BALANCES.available} />}
          note="On Base"
        />
        <StatTile
          label="Arriving"
          value={<Money {...SAMPLE_BALANCES.incoming} />}
          note="Confirming"
        />
        <StatTile
          label="Held for a refund"
          value={<Money {...SAMPLE_BALANCES.held} />}
          note="Not yours to spend"
        />
      </div>
      <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface px-4">
        {SAMPLE_PERSONAL_ACTIVITY.map((row) => (
          <ActivityRow key={row.title} {...row} />
        ))}
      </div>
    </PanelLayout>
  );
}

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
              className="mt-1 text-3xl text-ink"
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

export function MerchantPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.merchant}>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
        {SAMPLE_STORE_ACTIVITY.map((row) => (
          <ActivityRow key={row.title} {...row} />
        ))}
      </div>
    </PanelLayout>
  );
}

export function DevelopersPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.developers}>
      <ul className="mb-3 divide-y divide-line rounded-lg border border-line bg-surface px-4 font-mono text-sm">
        {SAMPLE_EVENTS.map((e) => (
          <li key={e.type} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-ink">{e.type}</span>
            <span className="text-subtle tabular-nums">{e.time}</span>
          </li>
        ))}
      </ul>
      <CodeBlock code={DEVELOPERS.code.split("\n\n")[0] ?? ""} language="TypeScript" />
    </PanelLayout>
  );
}
