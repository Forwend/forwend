import { HOW, LANDING_SECTIONS } from "@/screens/landing/landing-content";
import { Section } from "@/screens/landing/layout/section";

// One continuous path with four stops, not four cards.
export function HowItWorks() {
  return (
    <Section id="how" section={LANDING_SECTIONS.how} title={HOW.title}>
      <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
        {HOW.steps.map((step, i) => (
          <li key={step.title} className="group relative pl-8 md:pt-10 md:pl-0">
            <span
              aria-hidden
              className="absolute top-2 left-1.75 h-[calc(100%+--spacing(10))] w-px bg-line-strong md:top-1.75 md:left-0 md:h-px md:w-[calc(100%+--spacing(6))] group-last:hidden"
            />
            <span
              aria-hidden
              className={`absolute top-0 left-0 size-3.75 rounded-pill border-2 ${
                i === HOW.steps.length - 1 ? "border-accent bg-accent" : "border-ink bg-bg"
              }`}
            />
            <h3 className="text-xl font-semibold text-ink">{step.title}</h3>
            <p className="mt-2 text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
