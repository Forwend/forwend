import { BrandIcon } from "@forwend/ui-web";
import { LANDING_SECTIONS, NETWORKS } from "@/constants/landing";

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
      <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 text-xl text-ink md:justify-between">
        {ITEMS.map((item) => (
          <li
            key={item.name}
            className={`inline-flex items-center gap-2.5 ${item.mono ? "font-mono text-lg" : "font-medium tracking-tight"}`}
          >
            {item.logo ? <BrandIcon name={item.logo} className="size-[var(--fw-icon-lg)]" /> : null}
            {item.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
