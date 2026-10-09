import type { ReactNode } from "react";
import {
  type LandingSection,
  SECTION_LAYOUTS,
  type SectionLayout,
} from "@/screens/landing/landing-content";

interface SectionProps {
  id?: string;
  section: LandingSection;
  title: string;
  body?: string;
  children: ReactNode;
  className?: string;
  layout?: SectionLayout;
}

export function Section({
  id,
  section,
  title,
  body,
  children,
  className = "",
  layout = SECTION_LAYOUTS.stacked,
}: SectionProps) {
  const headingId = `${section}-title`;
  const split = layout === SECTION_LAYOUTS.split;
  return (
    <section
      id={id}
      data-section={section}
      aria-labelledby={headingId}
      className={`mx-auto max-w-6xl scroll-mt-28 px-4 py-20 sm:px-8 sm:py-24 ${
        split ? "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16" : ""
      } ${className}`}
    >
      <div>
        <h2 id={headingId} className="max-w-3xl font-display text-section text-ink">
          {title}
        </h2>
        {body ? <p className="mt-5 max-w-2xl text-lg text-muted">{body}</p> : null}
      </div>
      <div className={split ? "mt-14 lg:mt-2" : "mt-14"}>{children}</div>
    </section>
  );
}
