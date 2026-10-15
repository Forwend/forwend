import type { ReactNode } from "react";
import { SECTION_LAYOUTS } from "@/screens/landing/constants/landing-content";
import type { LandingSection, SectionLayout } from "@/screens/landing/types/landing-content";

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
      className={`mx-auto max-w-6xl fw-safe-x py-20 sm:[--fw-page-gutter:2rem] sm:py-24 ${
        split ? "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16" : ""
      } ${className}`}
    >
      <div>
        <h2 id={headingId} className="fw-reveal max-w-3xl font-display text-section text-ink">
          {title}
        </h2>
        {body ? (
          <p className="fw-reveal fw-reveal-late mt-5 max-w-2xl text-lg text-muted">{body}</p>
        ) : null}
      </div>
      <div className={`fw-reveal fw-reveal-late ${split ? "mt-14 lg:mt-2" : "mt-14"}`}>
        {children}
      </div>
    </section>
  );
}
