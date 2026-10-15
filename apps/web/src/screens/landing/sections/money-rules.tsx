import { StatusPill } from "@forwend/ui-web";
import { AlertTriangle } from "lucide-react";
import { LANDING_SECTIONS, RULES } from "@/screens/landing/constants/landing-content";
import { Section } from "@/screens/landing/layout/section";

export function MoneyRules() {
  return (
    <Section id="rules" section={LANDING_SECTIONS.rules} title={RULES.title} body={RULES.body}>
      <dl className="divide-y divide-line border-y border-line">
        {RULES.items.map((item) => (
          <div
            key={item.status}
            className="grid gap-3 py-6 md:grid-cols-[--spacing(64)_1fr] md:gap-10"
          >
            <dt>
              <StatusPill status={item.status} />
            </dt>
            <dd className="max-w-prose text-lg text-ink">{item.body}</dd>
          </div>
        ))}
        <div className="grid gap-3 py-6 md:grid-cols-[--spacing(64)_1fr] md:gap-10">
          <dt>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-transparent bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
              <AlertTriangle aria-hidden className="size-[var(--fw-icon-sm)]" />
              {RULES.wrongNetwork.title}
            </span>
          </dt>
          <dd className="max-w-prose text-lg text-ink">{RULES.wrongNetwork.body}</dd>
        </div>
      </dl>
      <p className="mt-6 max-w-2xl text-muted">{RULES.footnote}</p>
    </Section>
  );
}
