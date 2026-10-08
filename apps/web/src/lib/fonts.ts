import { Geist_Mono, Hanken_Grotesk, Libre_Caslon_Display } from "next/font/google";

// Feeds the --fw-font-*-loaded variables that packages/design-tokens reads (D-13).
const display = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--fw-font-display-loaded",
});
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--fw-font-sans-loaded" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--fw-font-mono-loaded" });

export const fontVars = [display, sans, mono].map((f) => f.variable).join(" ");
