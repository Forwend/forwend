import { WaitlistForm } from "@/features/waitlist/components/waitlist-form";
import { LANDING_SECTIONS } from "@/screens/landing/constants/landing-content";
import { HERO } from "@/screens/landing/sections/hero/constants/hero-content";
import { HeroProduct } from "@/screens/landing/sections/hero/hero-product";

export function Hero() {
  return (
    <section
      data-section={LANDING_SECTIONS.hero}
      aria-labelledby="hero-title"
      className="pt-28 pb-12 sm:pt-36"
    >
      <div className="mx-auto w-full max-w-7xl fw-safe-x sm:[--fw-page-gutter:2rem] lg:[--fw-page-gutter:2.5rem]">
        <h1
          id="hero-title"
          className="max-w-5xl text-hero font-medium tracking-[-0.045em] text-balance text-ink"
        >
          {HERO.title} <span className="text-subtle">{HERO.titleSub}</span>
        </h1>
        <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,26rem)_1fr] md:items-start md:gap-16">
          <div className="flex flex-col gap-2 [&>div]:justify-start">
            <WaitlistForm id="hero" />
            <p className="text-sm text-subtle">{HERO.note}</p>
          </div>
          <p className="max-w-md text-lg text-muted md:justify-self-end">{HERO.body}</p>
        </div>
        <HeroProduct />
      </div>
    </section>
  );
}
