import { ImageResponse } from "next/og";
import { HERO } from "@/screens/landing/sections/hero/hero-content";
import { ART } from "@/shared/art/art-colors";
import { BRAND_COLORS } from "@/shared/config/brand-colors";
import { SITE } from "@/shared/config/site";

export const alt = SITE.title;

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

// Built in code: the dawn sky, the river and the headline. No raster asset to keep in sync.
export default function OpengraphImage() {
  const C = ART.dawn;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: `linear-gradient(180deg, ${C.skyTop} 0%, ${C.skyMid} 55%, ${C.horizon} 100%)`,
        color: BRAND_COLORS.ink,
        fontFamily: "serif",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", fontSize: 34, fontFamily: "sans-serif", fontWeight: 700 }}>
        {SITE.name}
      </div>
      <div style={{ display: "flex", fontSize: 76, lineHeight: 1.04, maxWidth: 900 }}>
        {HERO.title}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 30,
          fontFamily: "sans-serif",
          color: BRAND_COLORS.muted,
        }}
      >
        {HERO.body}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 120,
          display: "flex",
          background: `linear-gradient(180deg, ${C.meadowLight}, ${C.meadow})`,
        }}
      />
    </div>,
    size,
  );
}
