import { ThemeSwitch } from "@forwend/ui-web";
import Link from "next/link";
import { ColorSwatches } from "@/components/kit/color-swatches";
import { KitSection } from "@/components/kit/kit-section";

export default function KitPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="sticky top-0 z-[var(--fw-z-nav)] -mx-4 flex items-center justify-between gap-4 border-b border-line bg-bg/90 px-4 py-4 backdrop-blur-md sm:-mx-8 sm:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Forwend kit</h1>
          <p className="text-sm text-muted">
            Private. Tokens and components used across the site and app.{" "}
            <Link href="/kit/directions" className="text-accent underline">
              Directions
            </Link>
          </p>
        </div>
        <ThemeSwitch />
      </header>
      <KitSection
        title="Colors"
        note="Semantic tokens. Each has a light and a dark value; switch the theme to compare."
      >
        <ColorSwatches />
      </KitSection>
    </main>
  );
}
