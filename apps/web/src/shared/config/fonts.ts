import { Geist_Mono, Hanken_Grotesk, Noto_Sans } from "next/font/google";

// "optional": a late swap rewraps text, and only preloaded files can show, so latin-ext is preloaded (Łukasz).
// The fallback face is in globals.css: next/font's own looks only for Arial, which Linux lacks.
const sans = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--fw-font-sans-loaded",
  display: "optional",
  adjustFontFallback: false,
  fallback: ["Hanken Grotesk Fallback"],
});

// "optional": no fallback has its width on every system, so a late swap would rewrap code and addresses.
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--fw-font-mono-loaded",
  display: "optional",
  adjustFontFallback: false,
  fallback: ["ui-monospace"],
});

// The invoice and receipt PDFs' face, so previews read like the file; it covers Greek and Cyrillic, Hanken doesn't.
const document = Noto_Sans({
  subsets: ["latin", "latin-ext", "cyrillic", "greek"],
  weight: ["400", "700"],
  variable: "--fw-font-document-loaded",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Noto Sans Fallback"],
});

export const fontVars = [sans, mono, document].map((f) => f.variable).join(" ");
