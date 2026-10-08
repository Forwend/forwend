import { CodeBlock } from "@forwend/ui-web";
import { Check } from "lucide-react";
import { DEVELOPERS, LANDING_SECTIONS } from "@/constants/landing";
import { Section } from "./section";

export function Developers() {
  return (
    <Section
      id="developers"
      section={LANDING_SECTIONS.developers}
      title={DEVELOPERS.title}
      body={DEVELOPERS.body}
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <ul className="flex flex-col gap-4">
          {DEVELOPERS.points.map((p) => (
            <li key={p} className="flex gap-3 text-lg text-ink">
              <Check aria-hidden className="mt-1 size-[var(--fw-icon-md)] shrink-0 text-accent" />
              {p}
            </li>
          ))}
        </ul>
        <div data-testid="developer-code">
          <CodeBlock code={DEVELOPERS.code} language="TypeScript" />
          <p className="mt-3 text-sm text-muted">{DEVELOPERS.note}</p>
        </div>
      </div>
    </Section>
  );
}
