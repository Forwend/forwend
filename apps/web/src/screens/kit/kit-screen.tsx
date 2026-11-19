import { ThemeSwitch } from "@forwend/ui-web";
import Link from "next/link";
import type { ReactNode } from "react";
import { ColorSwatches } from "@/screens/kit/color-swatches";
import { ComponentsShowcase } from "@/screens/kit/components-showcase";
import {
  IconSet,
  MotionSamples,
  RadiusSamples,
  ShadowSamples,
  SpacingScale,
  TypographySamples,
} from "@/screens/kit/foundations";
import { KitSection } from "@/screens/kit/kit-section";
import { LogoShowcase } from "@/screens/kit/logo-showcase";
import { MotionShowcase } from "@/screens/kit/motion-showcase";
import { PaymentsShowcase } from "@/screens/kit/payments-showcase";

const SECTIONS: readonly { title: string; note?: string; content: ReactNode }[] = [
  {
    title: "Logo",
    note: "The mark alone and with the wordmark, in both themes, plus the app icons.",
    content: <LogoShowcase />,
  },
  {
    title: "Colors",
    note: "Semantic tokens. Each has a light and a dark value; switch the theme to compare.",
    content: <ColorSwatches />,
  },
  {
    title: "Typography",
    note: "One grotesk for headlines, interface and money; mono for addresses, hashes and code.",
    content: <TypographySamples />,
  },
  {
    title: "Spacing",
    note: "4px base. Tailwind spacing utilities use this scale.",
    content: <SpacingScale />,
  },
  { title: "Radius", content: <RadiusSamples /> },
  {
    title: "Shadows",
    note: "Every shadow has an offset and a soft blur.",
    content: <ShadowSamples />,
  },
  {
    title: "Motion",
    note: "Exponential ease-out from a visible resting state.",
    content: <MotionSamples />,
  },
  {
    title: "Icons",
    note: "Lucide plus Forwend icons (Merchant, Freelancer, Payment path), one 1.75 stroke.",
    content: <IconSet />,
  },
  {
    title: "Animations",
    note: "Custom loaders and feedback, built from the motion tokens.",
    content: <MotionShowcase />,
  },
  { title: "Components", content: <ComponentsShowcase /> },
  { title: "Payment components", content: <PaymentsShowcase /> },
];

const anchor = (title: string) => title.toLowerCase().replace(/\s+/g, "-");

export function KitScreen() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="sticky top-0 z-[var(--fw-z-nav)] -mx-4 flex items-center justify-between gap-4 border-b border-line bg-bg/90 px-4 py-4 backdrop-blur-glass sm:-mx-8 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Forwend kit</h1>
          <nav
            aria-label="Kit sections"
            className="mt-1 flex gap-x-4 overflow-x-auto text-sm text-muted"
          >
            {SECTIONS.map(({ title }) => (
              <a key={title} href={`#${anchor(title)}`} className="shrink-0 hover:text-ink">
                {title}
              </a>
            ))}
            <Link href="/kit/directions" className="shrink-0 text-accent underline">
              Directions
            </Link>
          </nav>
        </div>
        <ThemeSwitch />
      </header>
      {SECTIONS.map(({ title, note, content }) => (
        <KitSection key={title} id={anchor(title)} title={title} note={note}>
          {content}
        </KitSection>
      ))}
    </main>
  );
}
