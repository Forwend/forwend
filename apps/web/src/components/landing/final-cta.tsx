import { HalftoneRidge } from "@/components/art/halftone-ridge";
import { FINAL_CTA, LANDING_SECTIONS } from "@/constants/landing";
import { WaitlistForm } from "./waitlist-form";

// Halftone Horizon raise: the dot ridge as a quiet texture behind the closing call to action.
export function FinalCta() {
  return (
    <section
      id="join"
      data-section={LANDING_SECTIONS.cta}
      aria-labelledby="cta-title"
      className="relative isolate mx-2 scroll-mt-28 overflow-hidden rounded-xl border border-line bg-surface sm:mx-3"
    >
      <HalftoneRidge soft className="absolute inset-x-0 bottom-0 -z-10 h-1/2 w-full opacity-50" />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-20 pb-40 text-center sm:pt-28 sm:pb-48">
        <h2
          id="cta-title"
          className="font-display text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1.06] tracking-[-0.015em] text-ink"
        >
          {FINAL_CTA.title}
        </h2>
        <p className="mt-5 max-w-lg text-lg text-muted">{FINAL_CTA.body}</p>
        <div className="mt-8 flex w-full justify-center">
          <WaitlistForm id="footer" />
        </div>
      </div>
    </section>
  );
}
