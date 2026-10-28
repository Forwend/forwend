import { Geist_Mono, Hanken_Grotesk } from "next/font/google";

// Feeds the --fw-font-*-loaded variables that packages/design-tokens reads (D-113). One grotesk sets headings, UI
// and money; the display role reuses it, so the landing loads no second face.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--fw-font-sans-loaded" });

// Addresses and hashes sit below the headline; not preloading keeps the first paint lighter.
const mono = Geist_Mono({ subsets: ["latin"], variable: "--fw-font-mono-loaded", preload: false });

export const fontVars = [sans, mono].map((f) => f.variable).join(" ");
