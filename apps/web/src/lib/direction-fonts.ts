import {
  Bodoni_Moda,
  Bricolage_Grotesque,
  Gloock,
  Instrument_Serif,
  Libre_Caslon_Display,
  Sora,
  Unbounded,
  Young_Serif,
} from "next/font/google";

// Display faces for the comps on /kit/directions only.
const caslon = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caslon",
});
const gloock = Gloock({ weight: "400", subsets: ["latin"], variable: "--font-gloock" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const youngSerif = Young_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-young-serif",
});
const instrument = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
});
const unbounded = Unbounded({ subsets: ["latin"], variable: "--font-unbounded" });
const bodoni = Bodoni_Moda({ subsets: ["latin"], variable: "--font-bodoni" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora" });

export const directionFontVars = [
  caslon,
  gloock,
  bricolage,
  youngSerif,
  instrument,
  unbounded,
  bodoni,
  sora,
]
  .map((f) => f.variable)
  .join(" ");
