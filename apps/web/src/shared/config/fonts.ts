import { Geist_Mono, Hanken_Grotesk, Noto_Sans } from "next/font/google";

// Feeds the --fw-font-*-loaded variables that packages/design-tokens reads (D-113). One grotesk sets headings, UI
// and money; the display role reuses it, so the landing loads no second face. Preloaded with "optional", like the mono
// face below: a fallback sized to its average width still breaks lines a few pixels apart, so a late swap rewrapped
// text. Only preloaded files can show, so latin-ext is preloaded for names such as Łukasz; Vietnamese and extended
// Cyrillic letters keep the fallback on a first visit. Its fallback face is in globals.css: next/font's looks only for
// Arial, which Linux lacks.
const sans = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--fw-font-sans-loaded",
  display: "optional",
  adjustFontFallback: false,
  fallback: ["Hanken Grotesk Fallback"],
});

// Preloaded with "optional": the face shows from the first paint when it arrives within the browser's short wait, and
// one that comes later is kept for the next page load, never swapped in. No fallback has its width on every system,
// so a swap rewrapped code and addresses.
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--fw-font-mono-loaded",
  display: "optional",
  adjustFontFallback: false,
  fallback: ["ui-monospace"],
});

// The invoice and receipt PDFs' own face (apps/backend/internal/document), for previews that must read like the
// file; it covers Greek and Cyrillic names, which Hanken doesn't. Fetched only where a preview shows, so it swaps in;
// its fallback face is in globals.css, like Hanken's.
const document = Noto_Sans({
  subsets: ["latin", "latin-ext", "cyrillic", "greek"],
  weight: ["400", "700"],
  variable: "--fw-font-document-loaded",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Noto Sans Fallback"],
});

export const fontVars = [sans, mono, document].map((f) => f.variable).join(" ");
