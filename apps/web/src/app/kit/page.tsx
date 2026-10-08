import { ThemeSwitch } from "@forwend/ui-web";
import Link from "next/link";
import { ColorSwatches } from "@/components/kit/color-swatches";
import { ComponentsShowcase } from "@/components/kit/components-showcase";
import {
  IconSet,
  MotionSamples,
  RadiusSamples,
  ShadowSamples,
  SpacingScale,
  TypographySamples,
} from "@/components/kit/foundations";
import { KitSection } from "@/components/kit/kit-section";
import { PaymentsShowcase } from "@/components/kit/payments-showcase";
import { KIT_SECTIONS } from "@/constants/kit-content";

export default function KitPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="sticky top-0 z-[var(--fw-z-nav)] -mx-4 flex items-center justify-between gap-4 border-b border-line bg-bg/90 px-4 py-4 backdrop-blur-glass sm:-mx-8 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Forwend kit</h1>
          <nav
            aria-label="Kit sections"
            className="mt-1 flex gap-x-4 overflow-x-auto text-sm text-muted"
          >
            {KIT_SECTIONS.map((s) => (
              <a
                key={s}
                href={`#${s.toLowerCase().replace(/\s+/g, "-")}`}
                className="shrink-0 hover:text-ink"
              >
                {s}
              </a>
            ))}
            <Link href="/kit/directions" className="shrink-0 text-accent underline">
              Directions
            </Link>
          </nav>
        </div>
        <ThemeSwitch />
      </header>
      <KitSection
        title="Colors"
        note="Semantic tokens. Each has a light and a dark value; switch the theme to compare."
      >
        <ColorSwatches />
      </KitSection>
      <KitSection
        title="Typography"
        note="A display serif for headlines, a quiet grotesk for everything else, mono for money."
      >
        <TypographySamples />
      </KitSection>
      <KitSection title="Spacing" note="4px base. Tailwind spacing utilities use this scale.">
        <SpacingScale />
      </KitSection>
      <KitSection title="Radius">
        <RadiusSamples />
      </KitSection>
      <KitSection title="Shadows" note="Every shadow has an offset and a soft blur.">
        <ShadowSamples />
      </KitSection>
      <KitSection title="Motion" note="Exponential ease-out from a visible resting state.">
        <MotionSamples />
      </KitSection>
      <KitSection
        title="Icons"
        note="Lucide plus Forwend icons (Merchant, Freelancer, Payment path), one 1.75 stroke."
      >
        <IconSet />
      </KitSection>
      <KitSection title="Components">
        <ComponentsShowcase />
      </KitSection>
      <KitSection title="Payment components">
        <PaymentsShowcase />
      </KitSection>
    </main>
  );
}
