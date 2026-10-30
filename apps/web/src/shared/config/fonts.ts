import { Geist_Mono, Hanken_Grotesk, Noto_Sans } from "next/font/google";

// Feeds the --fw-font-*-loaded variables that packages/design-tokens reads (D-113). One grotesk sets headings, UI
// and money; the display role reuses it, so the landing loads no second face.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--fw-font-sans-loaded" });

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
// file; it covers Greek and Cyrillic names, which Hanken doesn't. Fetched only where a preview shows.
const document = Noto_Sans({
  subsets: ["latin", "latin-ext", "cyrillic", "greek"],
  weight: ["400", "700"],
  variable: "--fw-font-document-loaded",
  preload: false,
});

export const fontVars = [sans, mono, document].map((f) => f.variable).join(" ");
