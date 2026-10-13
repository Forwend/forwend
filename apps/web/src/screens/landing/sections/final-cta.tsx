import { WaitlistForm } from "@/features/waitlist/components/waitlist-form";
import { FINAL_CTA, LANDING_SECTIONS } from "@/screens/landing/constants/landing-content";
import { HalftoneRidge } from "@/shared/components/art/halftone-ridge";

// Halftone Horizon raise: the dot ridge as a quiet texture behind the closing call to action.
export function FinalCta() {
  return (
    <section
      id="join"
      data-section={LANDING_SECTIONS.cta}
      aria-labelledby="cta-title"
      className="relative isolate scroll-mt-28 overflow-hidden border-y border-line bg-surface"
    >
      <HalftoneRidge soft className="absolute inset-x-0 bottom-0 -z-10 h-1/2 w-full opacity-50" />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-20 pb-40 text-center sm:pt-28 sm:pb-48">
        <h2 id="cta-title" className="font-display text-section text-ink">
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
