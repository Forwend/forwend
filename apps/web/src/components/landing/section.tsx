import type { SectionProps } from "@/types/landing/props";

export function Section({ id, section, title, body, children, className = "" }: SectionProps) {
  const headingId = `${section}-title`;
  return (
    <section
      id={id}
      data-section={section}
      aria-labelledby={headingId}
      className={`mx-auto max-w-6xl scroll-mt-28 px-4 py-20 sm:px-8 sm:py-24 ${className}`}
    >
      <h2
        id={headingId}
        className="max-w-3xl font-display text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1.06] tracking-[-0.015em] text-ink"
      >
        {title}
      </h2>
      {body ? <p className="mt-5 max-w-2xl text-lg text-muted">{body}</p> : null}
      <div className="mt-14">{children}</div>
    </section>
  );
}
