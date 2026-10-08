import { DawnLandscape } from "@/components/art/dawn-landscape";
import { HERO, LANDING_SECTIONS } from "@/constants/landing";
import { HeroJourney } from "./hero-journey";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
  return (
    <section
      data-section={LANDING_SECTIONS.hero}
      aria-labelledby="hero-title"
      className="relative isolate m-2 flex min-h-[max(46rem,calc(100svh-1rem))] flex-col overflow-hidden rounded-xl px-4 pt-4 pb-6 sm:m-3 sm:px-8 sm:pt-5"
    >
      <DawnLandscape className="absolute inset-0 -z-20 h-full w-full" />
      <div className="mx-auto mt-28 flex max-w-3xl flex-col items-center text-center sm:mt-36">
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
