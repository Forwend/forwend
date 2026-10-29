import { Geist_Mono, Hanken_Grotesk, Noto_Sans } from "next/font/google";

// Feeds the --fw-font-*-loaded variables that packages/design-tokens reads (D-113). One grotesk sets headings, UI
// and money; the display role reuses it, so the landing loads no second face.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--fw-font-sans-loaded" });

// Addresses and hashes sit below the headline; not preloading keeps the first paint lighter.
const mono = Geist_Mono({ subsets: ["latin"], variable: "--fw-font-mono-loaded", preload: false });

// The invoice and receipt PDFs' own face (apps/backend/internal/document), for previews that must read like the
// file; it covers Greek and Cyrillic names, which Hanken doesn't. Fetched only where a preview shows.
const document = Noto_Sans({
  subsets: ["latin", "latin-ext", "cyrillic", "greek"],
  weight: ["400", "700"],
  variable: "--fw-font-document-loaded",
  preload: false,
});

export const fontVars = [sans, mono, document].map((f) => f.variable).join(" ");
