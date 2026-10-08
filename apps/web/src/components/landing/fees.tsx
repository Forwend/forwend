import { Money } from "@forwend/ui-web";
import { FEES, LANDING_SECTIONS } from "@/constants/landing";
import { SAMPLE_WITHDRAWAL } from "@/constants/landing-samples";
import { Section } from "./section";

export function Fees() {
  return (
    <Section id="fees" section={LANDING_SECTIONS.fees} title={FEES.title} body={FEES.body}>
      <div className="max-w-xl rounded-xl border border-line bg-surface p-6 shadow-md">
        <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <p className="font-medium text-ink">{FEES.quote.title}</p>
          <p className="text-sm text-muted">
            You send <Money {...SAMPLE_WITHDRAWAL} className="text-ink" />
          </p>
        </div>
        <dl className="divide-y divide-line">
          {FEES.quote.lines.map((line) => (
            <div key={line} className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-ink">{line}</dt>
              <dd className="text-sm text-subtle">{FEES.quote.pending}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-5 max-w-xl text-sm text-muted">{FEES.note}</p>
    </Section>
  );
}
