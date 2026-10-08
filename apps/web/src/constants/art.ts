// Illustration colors for the code-drawn stand-in art. These are artwork, not UI tokens.
export const ART = {
  dawn: {
    skyTop: "#B9D5E0",
    skyMid: "#D9E9EC",
    horizon: "#F3F1E4",
    glow: "#FBF1CF",
    far: "#A9C3CB",
    mid: "#8BABAF",
    hillFar: "#7DA38F",
    meadow: "#7FA868",
    meadowLight: "#AFC982",
    riverDeep: "#6FAAC4",
    riverLight: "#E2F0F1",
    pine: "#2B4F3F",
    pineFar: "#4A7460",
    haze: "#F4F8F7",
  },
  dusk: {
    skyTop: "#1C1930",
    skyMid: "#4B3452",
    horizon: "#D4865C",
    sun: "#F2C48C",
    ridgeFar: "#3B2E46",
    ridgeMid: "#262031",
    ridgeNear: "#16141D",
    ground: "#0D0C11",
  },
  halftone: {
    ground: "#F1F4FA",
    dot: "#1F44D6",
    dotSoft: "#9DB0F2",
    /** Dawn Path river blue, for the halftone texture on the landing. */
    dotDawn: "#8DBFD4",
  },
} as const;

// UI colors used only by the three direction comps until F004 turns the chosen one into tokens.
export const COMP_UI = {
  dawn: {
    ink: "#0F2219",
    muted: "#33493F",
    line: "rgba(15, 34, 25, 0.12)",
    surface: "rgba(255, 255, 255, 0.72)",
    accent: "#2C6E91",
    onInk: "#F5FAF7",
  },
  dusk: {
    ink: "#F4EEE8",
    muted: "#DDD3CC",
    line: "rgba(255, 255, 255, 0.10)",
    surface: "#17151E",
    accent: "#E9A26B",
    onInk: "#17151E",
    scrim: "rgba(13, 12, 17, 0.78)",
  },
  halftone: {
    ink: "#0D1530",
    muted: "#46517A",
    line: "#D3DAEA",
    surface: "#FFFFFF",
    accent: "#1F44D6",
    onInk: "#FFFFFF",
  },
} as const;
