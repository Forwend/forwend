import { HERO, LANDING_SECTIONS } from "@/constants/landing";
import { HeroJourney } from "./hero-journey";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
  return (
    <section
      data-section={LANDING_SECTIONS.hero}
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[62rem] flex-col px-4 pt-4 pb-6 sm:min-h-[64rem] sm:px-8 sm:pt-5 lg:min-h-svh"
    >
      <div className="mx-auto mt-24 flex w-full max-w-3xl flex-col items-center text-center sm:mt-36">
        <h1
          id="hero-title"
          className="font-display text-[clamp(2.75rem,7vw,5.25rem)] leading-[1.02] tracking-[-0.02em] text-ink"
        >
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
