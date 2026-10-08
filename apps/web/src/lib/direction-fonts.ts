import {
  Bricolage_Grotesque,
  Geist_Mono,
  Gloock,
  Hanken_Grotesk,
  Libre_Caslon_Display,
} from "next/font/google";

export const caslon = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caslon",
});
export const gloock = Gloock({ weight: "400", subsets: ["latin"], variable: "--font-gloock" });
export const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
export const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
export const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const directionFontVars = [caslon, gloock, bricolage, hanken, geistMono]
  .map((f) => f.variable)
  .join(" ");
