import { Money } from "@forwend/ui-web";
import { FEES, LANDING_SECTIONS, SECTION_LAYOUTS } from "@/screens/landing/landing-content";
import { Section } from "@/screens/landing/layout/section";

// Demonstration amount for the withdrawal example.
const USDC = { decimals: 6, token: "USDC" } as const;

const SAMPLE_WITHDRAWAL = { baseUnits: 500000000n, ...USDC } as const;

export function Fees() {
  return (
    <Section
      id="fees"
      section={LANDING_SECTIONS.fees}
      title={FEES.title}
      body={FEES.body}
      layout={SECTION_LAYOUTS.split}
    >
      <div className="rounded-lg border border-line bg-surface p-6 shadow-md">
        <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <p className="font-medium text-ink">{FEES.quote.title}</p>
          <p className="text-sm text-muted">
            You send <Money {...SAMPLE_WITHDRAWAL} className="text-ink" />
          </p>
        </div>
        <dl className="divide-y divide-line">
          {FEES.quote.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between gap-4 py-3.5">
              <dt className="shrink-0 text-ink">{line.label}</dt>
              <dd className="text-right text-sm text-muted">{line.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-5 text-sm text-muted">{FEES.note}</p>
    </Section>
  );
}
