import { BrandIcon } from "@forwend/ui-web";
import { LANDING_SECTIONS, NETWORKS } from "@/screens/landing/landing-content";

const ITEMS = [
  ...NETWORKS.networks.map((n) => ({ ...n, mono: false })),
  ...NETWORKS.tokens.map((t) => ({ ...t, mono: true })),
];

export function Networks() {
  return (
    <section
      data-section={LANDING_SECTIONS.networks}
      aria-label={NETWORKS.label}
      className="mx-auto max-w-6xl px-4 py-10 sm:px-8"
    >
      {/* From lg each item takes an equal share and divide-x draws one line between neighbours;
          on phones items wrap, so there are no dividers to dangle at line ends. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 text-xl text-ink lg:flex-nowrap lg:gap-x-0 lg:divide-x lg:divide-line-strong">
        {ITEMS.map((item) => (
          <li
            key={item.name}
            className={`inline-flex items-center gap-2.5 lg:flex-1 lg:justify-center ${item.mono ? "font-mono text-lg" : "font-medium tracking-tight"}`}
          >
            {item.logo ? <BrandIcon name={item.logo} className="size-[var(--fw-icon-lg)]" /> : null}
            {item.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
