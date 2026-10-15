import { WaitlistForm } from "@/features/waitlist/components/waitlist-form";
import { LANDING_SECTIONS } from "@/screens/landing/constants/landing-content";
import { HERO } from "@/screens/landing/sections/hero/constants/hero-content";
import { HeroJourney } from "@/screens/landing/sections/hero/hero-journey";

export function Hero() {
  return (
    <section
      data-section={LANDING_SECTIONS.hero}
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-248 flex-col max-sm:min-h-[calc(100svh+32rem)] fw-safe-x pt-4 pb-6 sm:min-h-256 sm:[--fw-page-gutter:2rem] sm:pt-5 lg:min-h-svh"
    >
      {/* Phones: the headline and form fill the first screen, centered over the sky. The section is taller there, so
          the river (which sits at a fixed share of the art's height) starts below the fold and leads to the invoice. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center text-center max-sm:min-h-[calc(100svh-2.5rem)] max-sm:pt-16 sm:mt-36">
        <h1 id="hero-title" className="font-display text-hero text-ink">
          {HERO.title}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted sm:text-xl">{HERO.body}</p>
        <div className="mt-8 flex w-full justify-center">
          <WaitlistForm id="hero" />
        </div>
        <p className="mt-1 text-sm text-ink">{HERO.note}</p>
      </div>
      <HeroJourney />
    </section>
  );
}
