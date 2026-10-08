import { Bricolage_Grotesque, Gloock, Libre_Caslon_Display } from "next/font/google";

// Display faces for the three comps on /kit/directions only.
const caslon = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caslon",
});
const gloock = Gloock({ weight: "400", subsets: ["latin"], variable: "--font-gloock" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

export const directionFontVars = [caslon, gloock, bricolage].map((f) => f.variable).join(" ");
