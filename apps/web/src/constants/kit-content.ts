// What the /kit page displays. Values mirror packages/design-tokens/src/{tokens,theme}.css.
export const KIT_SECTIONS = [
  "Colors",
  "Typography",
  "Spacing",
  "Radius",
  "Shadows",
  "Motion",
  "Icons",
  "Animations",
  "Components",
  "Payment components",
] as const;

export const TYPE_SCALE = [
  { token: "text-6xl", size: "5.25rem", sample: "Get paid." },
  { token: "text-5xl", size: "4rem", sample: "Get paid in stablecoins." },
  { token: "text-4xl", size: "3rem", sample: "See every step." },
  { token: "text-3xl", size: "2.25rem", sample: "Payment settled to your wallet" },
  { token: "text-2xl", size: "1.75rem", sample: "Invoice FW-0042" },
  { token: "text-xl", size: "1.375rem", sample: "Where is my money right now?" },
  { token: "text-lg", size: "1.125rem", sample: "Each payment moves from detected to settled." },
  { token: "text-base", size: "1rem", sample: "Body copy reads at 65 to 75 characters a line." },
  { token: "text-sm", size: "0.875rem", sample: "Labels, helper text and table cells." },
  { token: "text-xs", size: "0.75rem", sample: "Captions and status pills." },
] as const;

export const SPACING_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const;

export const RADII = ["sm", "md", "lg", "xl", "pill"] as const;

export const SHADOWS = ["sm", "md", "lg"] as const;

export const DURATIONS = [
  { token: "--fw-duration-fast", ms: 140, use: "Hover, press, small color changes" },
  { token: "--fw-duration-base", ms: 240, use: "Toggles, tabs, theme change" },
  { token: "--fw-duration-slow", ms: 480, use: "Panels, payment step changes" },
  { token: "--fw-duration-slower", ms: 900, use: "The hero river drawing forward" },
] as const;

export const EASINGS = [
  {
    token: "--fw-ease-out",
    curve: "cubic-bezier(0.16, 1, 0.3, 1)",
    use: "Default: enter and respond",
  },
  {
    token: "--fw-ease-in-out",
    curve: "cubic-bezier(0.65, 0, 0.35, 1)",
    use: "Moves between two resting states",
  },
] as const;

// Role sizes from theme.css: fluid, each with its own line height and letter spacing.
export const TYPE_ROLES = [
  { token: "text-hero", className: "font-display text-hero", sample: "Get paid in stablecoins." },
  { token: "text-section", className: "font-display text-section", sample: "See every step." },
  {
    token: "text-amount-lg",
    className: "font-mono tabular-nums text-amount-lg",
    sample: "1,250.00",
  },
  { token: "text-amount", className: "font-mono tabular-nums text-amount", sample: "1,250.00" },
  {
    token: "text-2xs",
    className: "font-mono text-2xs",
    sample: "Tx 0x8f3a…c21d · settled to your wallet",
  },
] as const;
