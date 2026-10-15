import { BrandIcon } from "@forwend/ui-web";
import { LANDING_SECTIONS, NETWORKS } from "@/screens/landing/constants/landing-content";

const ITEMS = [...NETWORKS.networks, ...NETWORKS.tokens];

function Item({ item, hidden = false }: { item: (typeof ITEMS)[number]; hidden?: boolean }) {
  return (
    <li
      aria-hidden={hidden || undefined}
      className={`inline-flex shrink-0 items-center gap-2.5 font-medium tracking-tight ${hidden ? "motion-reduce:hidden" : ""}`}
    >
      <BrandIcon name={item.logo} className="size-[var(--fw-icon-lg)]" />
      {item.name}
    </li>
  );
}

export function Networks() {
  return (
    <section
      data-section={LANDING_SECTIONS.networks}
      aria-labelledby="networks-title"
      className="mx-auto max-w-6xl py-10 sm:px-8"
    >
      <p id="networks-title" className="mb-6 px-4 text-center text-sm text-muted">
        {NETWORKS.label}
      </p>
      {/* Wide screens: one row, an equal share each, a line between neighbours. */}
      <ul className="hidden items-center text-xl text-ink lg:flex lg:divide-x lg:divide-line-strong [&>li]:flex-1 [&>li]:justify-center">
        {ITEMS.map((item) => (
          <Item key={item.name} item={item} />
        ))}
      </ul>
      {/* Narrower: one row drifting sideways (paused under a pointer), its ends fading out; the second copy only
          closes the loop, so screen readers hear the set once. Reduced motion leaves a still row to swipe. */}
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_3rem,black_calc(100%-3rem),transparent)] motion-reduce:overflow-x-auto lg:hidden">
        <ul className="flex w-max items-center gap-10 pr-10 text-lg text-ink animate-[fw-marquee_var(--fw-duration-marquee)_linear_infinite] hover:[animation-play-state:paused] motion-reduce:animate-none motion-reduce:px-6">
          {[false, true].flatMap((copy) =>
            ITEMS.map((item) => (
              <Item key={`${item.name}${copy ? "-loop" : ""}`} item={item} hidden={copy} />
            )),
          )}
        </ul>
      </div>
    </section>
  );
}
