import { LANDING_SECTIONS, NETWORKS } from "@/constants/landing";

export function Networks() {
  return (
    <section
      data-section={LANDING_SECTIONS.networks}
      aria-label={NETWORKS.label}
      className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-8 md:flex-row md:items-center md:justify-between"
    >
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xl text-ink">
        {NETWORKS.networks.map((n) => (
          <li key={n} className="font-medium tracking-tight">
            {n}
          </li>
        ))}
        <li aria-hidden className="hidden h-5 w-px bg-line-strong sm:block" />
        {NETWORKS.tokens.map((t) => (
          <li key={t} className="font-mono text-lg">
            {t}
          </li>
        ))}
      </ul>
      <p className="max-w-sm text-sm text-muted">{NETWORKS.note}</p>
    </section>
  );
}
