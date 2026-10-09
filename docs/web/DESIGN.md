---
name: Forwend
description: Stablecoin invoices, checkout and payouts, drawn as a calm path toward a bright horizon.
colors:
  dawn-mist: "#f4f8f7"
  paper-white: "#ffffff"
  meadow-wash: "#eaf2f0"
  sunken-mist: "#e2ecea"
  glass-white: "rgb(255 255 255 / 0.72)"
  pine-ink: "#0f2219"
  moss-muted: "#3a5047"
  lichen-subtle: "#566a62"
  frost-line: "#d3e0dc"
  sage-line: "#a9bfb8"
  on-ink: "#f5faf7"
  river-blue: "#1f6a8c"
  on-river: "#ffffff"
  settled-green: "#1b6e45"
  settled-green-soft: "#e2f2e9"
  amber-warning: "#865500"
  amber-warning-soft: "#f8eed8"
  signal-red: "#b42318"
  signal-red-soft: "#fbe9e7"
  river-info-soft: "#e3f0f6"
  dusk-ground: "#0d1412"
  dusk-surface: "#141d1a"
  dusk-surface-2: "#1a2521"
  dusk-sunken: "#0a0f0d"
  dusk-glass: "rgb(20 29 26 / 0.72)"
  dusk-ink: "#eef4f1"
  dusk-muted: "#b4c3bd"
  dusk-subtle: "#8fa29a"
  dusk-line: "#25322d"
  dusk-line-strong: "#3a4a43"
  dusk-river: "#7cc0dd"
  dusk-on-river: "#0b1a22"
  dusk-success: "#5cc08b"
  dusk-success-soft: "#12291e"
  dusk-warning: "#e3b054"
  dusk-warning-soft: "#2c2210"
  dusk-danger: "#f0857a"
  dusk-danger-soft: "#2f1714"
  dusk-info-soft: "#102430"
  art-ridge-far: "#a9c3cb"
  art-ridge-mid: "#8babaf"
  art-ridge-near: "#7da38f"
  art-dot: "#8dbfd4"
  dusk-art-ridge-far: "#1d2a33"
  dusk-art-ridge-mid: "#17222a"
  dusk-art-ridge-near: "#122019"
  dusk-art-dot: "#2f5f73"
typography:
  display:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "clamp(2.75rem, 7vw, 5.25rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "clamp(2.25rem, 4.6vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.06
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.4
  lead:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
  amount:
    fontFamily: "Geist Mono, SFMono-Regular, monospace"
    fontSize: "clamp(1.625rem, 8vw, 1.875rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  amount-lg:
    fontFamily: "Geist Mono, SFMono-Regular, monospace"
    fontSize: "clamp(1.75rem, 7.5vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  micro:
    fontFamily: "Geist Mono, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1.25rem"
  xl: "1.75rem"
  pill: "9999px"
spacing:
  gutter-mobile: "16px"
  gutter: "32px"
  heading-gap: "56px"
  section-mobile: "80px"
  section: "96px"
  split-gap: "64px"
  container: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.pine-ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklab, #0f2219 86%, #f4f8f7)"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.meadow-wash}"
  button-disabled:
    backgroundColor: "{colors.meadow-wash}"
    textColor: "{colors.lichen-subtle}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.meadow-wash}"
  text-field:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  email-capture:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 6px 6px 20px"
    height: "54px"
  theme-switch:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.pill}"
    size: "40px"
  nav-pill:
    backgroundColor: "{colors.glass-white}"
    textColor: "{colors.moss-muted}"
    rounded: "{rounded.pill}"
    padding: "6px 6px 6px 20px"
  panel-solid:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  panel-glass:
    backgroundColor: "{colors.glass-white}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-tray:
    backgroundColor: "{colors.meadow-wash}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge-neutral:
    backgroundColor: "{colors.meadow-wash}"
    textColor: "{colors.moss-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  status-pill-settled:
    backgroundColor: "{colors.settled-green-soft}"
    textColor: "{colors.settled-green}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  token-chip:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.pine-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  code-block:
    backgroundColor: "{colors.dusk-sunken}"
    textColor: "{colors.dusk-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  tooltip:
    backgroundColor: "{colors.pine-ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
---

# Design System: Forwend

## Overview

**Creative North Star: "Dawn Path"**

The payment is a path. A river runs from the viewer toward a bright horizon, and an invoice moves along it through four steps: detected, confirming, paid, settled. The world is a cool dawn landscape (pale sky, meadow greens, river blue) under one deep green-black ink that carries all type and the main buttons. Product UI sits on top of the landscape, built in code, never painted in.

Density is low on the landing and medium inside product panels. The sky stays open: the hero headline sits in the upper third, and the rest of the sky is left empty on purpose (charged emptiness, meaning space that is kept empty because it gives weight to what is near it). Product showcases drop into dark full-bleed bands ("Dusk Ledger"), and a halftone dot field in river blue is a quiet secondary texture ("Halftone Horizon"). Both themes, light and dark, are complete and cover the whole site: `data-theme` on `<html>` picks the theme before the first paint (the saved choice, else the system setting), and a section can still force dark locally with `data-theme="dark"`.

The hero and checkout art are generated images: a dawn landscape, a night landscape with the same composition (so the river marks line up in both themes), and a dusk ridge for the checkout band. The footer ridges and the soft halftone dots are code-drawn SVG, colored by the art tokens, which change with the theme. The footer ridges carry a paper grain in light only; at night the grain would grey out the dark ridges.

**Key Characteristics:**
- One ink (#0f2219) for type and primary buttons; no cream, no warm paper.
- River blue is the only accent and also means "current step" and "info".
- Serif display over a quiet grotesk; every amount and address in mono with tabular figures.
- Everything round: pill buttons, pill nav, pill chips, generous card corners; page bands run edge to edge with no corners.
- Glass only over imagery; solid surfaces everywhere else.
- Statuses change in place; row geometry never moves.

## Colors

A cool, green-leaning neutral palette with one river-blue accent and four soft status pairs, mirrored by a full dusk (dark) set, plus four art colors for code-drawn art.

### Primary
- **Pine Ink** (pine-ink): the one ink. Body text, headings, primary button fill, tooltip fill, completed timeline segments. In dark it flips to Dusk Ink and the primary button becomes light on dark (dusk-ink fill, pine-ink text).

### Secondary
- **River Blue** (river-blue): the only accent. Links, focus rings, caret, selection tint (28% mix), checked switch, the current timeline step, lit river marks, and check icons in feature lists. Its dark twin is Dusk River (dusk-river).

### Status
- **Settled Green** / soft: success, settled, incoming amounts.
- **Amber Warning** / soft: wrong-network notes, partial payment, expiry.
- **Signal Red** / soft: errors, invalid input borders, wrong-network rule.
- **River Info Soft**: info and accent badges use River Blue text on this ground.
Each text color sits on its own soft ground; every pair is covered by the design-tokens contrast test.

### Neutral
- **Dawn Mist** (dawn-mist): page ground and theme-color (Dusk Ground at night).
- **Paper White** (paper-white): solid surfaces: cards, fields, solid panels, the final call-to-action band.
- **Meadow Wash** (meadow-wash): second surface: hover fill, neutral badges, tab track, showcase trays.
- **Sunken Mist** (sunken-mist): recessed areas.
- **Glass White** (glass-white): translucent fill for the nav pill and panels over the landscape only.
- **Moss Muted** (moss-muted): secondary text, subheads, nav links.
- **Lichen Subtle** (lichen-subtle): placeholders, upcoming steps, timestamps, icons at rest.
- **Frost Line** (frost-line): dividers and card borders.
- **Sage Line** (sage-line): stronger borders on fields and secondary buttons, scrollbar thumb, the how-it-works path line.

### Art
- **Ridge Far / Mid / Near** (art-ridge-far, art-ridge-mid, art-ridge-near): the three layers of the footer ridges, from pale blue-grey to green. At night they turn to near-black blue-greens (dusk-art-ridge-*).
- **Art Dot** (art-dot): the soft halftone dots behind the final call to action; a deep muted blue at night (dusk-art-dot).

### Named Rules
**The One Ink Rule.** Type and the primary button use the same ink. Do not add a second dark color for headings or buttons.

**The River Means Now Rule.** River blue marks the current or lit step and interactive affordances. Completed steps are ink, upcoming steps are line color. Do not use river blue for decoration in UI.

**The Token-Only Rule.** Tailwind's default palette is removed; only token colors exist as utilities. Art colors (the art tokens and the images) are for art only and never appear in UI components. The hex values in `src/constants/art.ts` belong to the old direction comps and the Open Graph image, not to new UI.

## Typography

**Display Font:** Libre Caslon Display, weight 400 only (with Georgia, serif)
**Body Font:** Hanken Grotesk (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with SFMono-Regular, monospace)

**Character:** A high-contrast book serif gives the headlines a calm, printed voice; the grotesk stays out of the way; the mono makes numbers read as exact.

### Hierarchy
- **Display** (400, clamp 2.75rem to 5.25rem, 1.02, -0.02em; token `text-hero`): the hero headline only, centered.
- **Headline** (400, clamp 2.25rem to 3.75rem, 1.06, -0.015em; token `text-section`): every section heading (h2), including the dark checkout band and the final call to action. Max width 48rem.
- **Title** (grotesk 600, 1.375rem, 1.4): step titles and sub-headings (h3). Profile panel titles use 1.75rem at the same weight.
- **Lead** (400, 1.125rem, 1.6): the paragraph under a heading, in Moss Muted, max width about 42rem; the hero lead grows to 1.375rem from 640px; rule rows use it in ink at max 65ch.
- **Body** (400, 1rem, 1.6): running text, FAQ answers (max 65ch).
- **Label** (500, 0.75rem): badges, status pills, token chips, timeline labels. Sentence case, no tracking.
- **Amount** (mono, tabular figures, -0.025em, line height 1.1; token `text-amount`, clamp 1.625rem to 1.875rem): the amount in the hero invoice panel. Inline amounts in running text take the size of the text around them.
- **Amount Large** (same, token `text-amount-lg`, clamp 1.75rem to 2.25rem): the amount on the checkout card.
- **Unit** (token `text-unit`, 0.8em of the amount): the token name after an amount, in Moss Muted.
- **Micro** (0.6875rem, line height 1rem; token `text-2xs`): the mono transaction line in the hero panel on phones; 0.75rem from 640px.

### Named Rules
**The Mono Money Rule.** Every amount, address, transaction hash and event name is set in Geist Mono with tabular figures. Never set a number that represents money in the serif or grotesk.

**The One Serif Weight Rule.** The display serif is loaded at 400 only. Do not bold it or use it below headline size.

**The Role Token Rule.** The hero headline, section headings and featured amounts use their role tokens (`text-hero`, `text-section`, `text-amount`, `text-amount-lg`). Do not write a one-off size for them.

**The No Kicker Rule.** No eyebrow labels or uppercase tracked text above headings. The heading speaks first.

## Layout

Content sits in a centered container of 72rem with 16px side padding on phones and 32px from 640px up. Sections stack vertically with 80px top and bottom padding on phones and 96px from 640px up; content starts 56px below a section heading. The heading block is left-aligned in regular sections and centered in the hero and final call to action.

Sections come in two layouts. **Stacked** (the default): heading and lead on top, content 56px below. **Split**: from 1024px the heading sits on the left and the content on the right (5fr to 7fr, 64px gap); below 1024px it stacks. Fees and FAQ use split.

Three bands run full-bleed, edge to edge, with no inset and no corners: the hero, the dark checkout band and the closing call-to-action band. The hero fills the full viewport height from 1024px (at least 62rem on phones, 64rem from 640px). Its art covers the band and fades into Dawn Mist through a gradient over the bottom sixth; below 1024px the art stops 9rem above the bottom, so the fade happens behind the invoice panel. The headline sits in the upper third, and the sample invoice panel sits low on the river, right-aligned 80px from the edge from 1024px and centered below. The checkout band is dark, with its image across the top 28rem fading into the dusk ground, and 80px (112px from 640px) vertical padding. The call-to-action band is Paper White between two Frost Line rules, with the soft halftone dots across its lower half.

Inside sections, two-column splits appear from 1024px (text column next to a product panel, roughly 0.8fr to 1.2fr; the checkout band uses 1fr to 1fr). Step sequences are one connected line, horizontal from 768px and vertical below, never a row of cards. Breakpoints are Tailwind defaults (640, 768, 1024px).

## Elevation & Depth

A hybrid: soft ink-tinted shadows for lift, plus tonal layering (Meadow Wash trays holding Paper White cards). Shadows are long and low, never hard or offset. Glass panels add a 14px backdrop blur and only appear over the landscape. Dark theme shadows switch to black at higher opacity. Over the hero art, a soft radial scrim of the page ground (about 80% strength, centered behind the headline and form) keeps the text readable over the bright mountains; it is a gradient, not a shadow.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgb(15 34 25 / 0.06), 0 1px 1px rgb(15 34 25 / 0.04)`): solid panels, fields, secondary buttons, stat tiles, active tab.
- **Lift** (`0 10px 24px -12px rgb(15 34 25 / 0.28)`): primary buttons, nav pill, email capture, the fees card, tooltip.
- **Float** (`0 28px 56px -24px rgb(15 34 25 / 0.38)`): glass panels on imagery, the checkout card, toast, dialog.

### Named Rules
**The Glass Over Land Rule.** A translucent, blurred panel is allowed only where it sits on landscape art (the hero invoice) and for the fixed nav pill, which floats over every section. Everywhere else panels are solid.

## Shapes

Round and soft. Five radii: 0.5rem for tiny controls, 0.75rem for fields, tooltips and QR codes, 1.25rem for every card and panel (including the checkout card, the fees card, tabs track and code blocks), 1.75rem only for frames that hold cards (the profile panel tray), and full pill for every button, chip, badge, nav and timeline bar. Full-bleed bands have no radius. Borders are 1px in Frost Line or Sage Line; empty states use a dashed Sage Line border. Step markers are 15px rings (2px border); the last step is filled river blue. The river mark circles grow from radius 6 to 9 when lit.

**The Band, Card, Frame Rule.** Bands are full-bleed with square edges. Cards are 1.25rem. Only a frame that contains cards gets 1.75rem.

## Components

### Buttons
Calm and solid: ink pills that press down 1px.
- **Shape:** full pill. Sizes 32px (sm, 14px text), 40px (md, 14px text), 48px (lg, 16px text), weight 500.
- **Primary:** Pine Ink fill, On Ink text, Lift shadow. Hover mixes the ink 86% with the page ground.
- **Secondary:** Paper White with Sage Line border and Rest shadow; hover to Meadow Wash.
- **Ghost:** no fill; hover to Meadow Wash. **Link:** River Blue, 1px underline thickening to 2px on hover.
- **Focus / Active:** global 2px River Blue outline at 3px offset; active translates 1px down.
- **Disabled:** Meadow Wash fill, Lichen Subtle text, Frost Line border, no shadow, no pointer events. Every variant looks the same when disabled.
- **Loading:** keeps the variant's own colors, shows a 16px spinner, sets `aria-busy` and `aria-disabled`, shows a progress cursor and ignores clicks. It never greys out.

### Chips and Status Pills
- **Badge:** pill, 0.75rem/500, tone pair (neutral is Meadow Wash with a Frost Line border; tones use the soft ground with a transparent border). "Sample" badges mark all demo data.
- **Status Pill:** same shape plus a 16px icon; ten payment statuses map to tones. The border is always present (transparent for tones), so a status can change in place without moving the row.
- **Token Chip:** two-part pill: token on Paper White, network on Meadow Wash, split by a Frost Line rule.

### Cards / Containers
- **Corner Style:** 1.25rem for all cards and panels; 1.75rem only for a tray that holds cards.
- **Background:** Paper White on Dawn Mist; trays in Meadow Wash hold white cards.
- **Shadow Strategy:** Rest by default, Lift for a featured card, Float for glass and dialogs.
- **Border:** 1px Frost Line; glass panels use a 60% white border.
- **Internal Padding:** 20px (24 to 28px on larger cards).

### Inputs / Fields
- **Style:** 44px tall, 0.75rem radius, Paper White, Sage Line border, Rest shadow; hover border to Lichen Subtle.
- **Focus:** border turns River Blue plus a 4px ring of River Blue at 22%.
- **Error / Disabled:** Signal Red border and message. Disabled: Frost Line border, Meadow Wash fill and Lichen Subtle text, with a not-allowed cursor.
- **Email Capture:** the signature form: one pill of fixed height (54px: 1px border, 6px padding, 40px button) with the field and a primary button inside it, Lift shadow, Sage Line border, same 4px ring on focus-within. The confirmation uses the same pill (Frost Line border) with a round Settled Green check, the message in ink and the email in Moss Muted, so nothing jumps between states. Browser autofill is painted Paper White (the surface token) with ink text. An error turns the border Signal Red and shows the message on a solid Paper White pill chip with Rest shadow, in a 28px row that is always reserved. A hidden live region stays mounted in every state so screen readers announce the error or the confirmation.

### Navigation
A floating glass pill fixed 20px (24px from 640px) from the top, centered: brand in grotesk 600, links at 14px in Moss Muted turning ink on hover (hidden below 768px), then a 32px theme switch (sun or moon icon, no fill or border inside the nav) and a small primary "Join waitlist" pill at its right end. Standing alone, the theme switch is a 40px Paper White pill with a Frost Line border and Rest shadow, hover to Meadow Wash. Its icon follows `data-theme` through CSS, so it is right before the page loads its scripts.

### Payment Timeline (signature)
A grid of equal columns, one per step. Each step is a 4px pill bar plus a 0.75rem label: ink when complete, River Blue when current, Frost Line when upcoming, with a 480ms color change. Optional detail ("8 of 12") is mono in Lichen Subtle.

### Hero River (signature)
The river path draws forward over 3.6s (four times the 900ms duration, out-expo easing) while each invoice step lights a mark on the river, in step with the invoice panel's timeline. With reduced motion the final state shows at once. In light, the river line is white (on-accent) at 85% and lit marks are River Blue with a white ring; at night the water is dark, so the line (70%) and the lit rings switch to the light ink.

### Code Block
Always dark (`data-theme="dark"` locally) on the sunken dusk ground, 1.25rem radius, mono 14px, with a header row naming the language and a copy button.

## Do's and Don'ts

### Do:
- **Do** use Pine Ink for type and primary buttons, and River Blue only for the current step, links, focus and lit marks.
- **Do** set every amount, address and hash in Geist Mono with tabular figures.
- **Do** run the hero, the checkout band and the call-to-action band edge to edge; give cards 1.25rem and only card-holding frames 1.75rem.
- **Do** switch a product showcase to dark with `data-theme="dark"` on the section, not with separate dark colors.
- **Do** write theme-only differences with the `dark:` variant, which follows `data-theme`, not the system setting.
- **Do** label every piece of demo data with a "Sample" badge.
- **Do** keep statuses the same size across states so a change happens in place.
- **Do** use motion tokens: 140ms for hover, 240ms for theme and accordions, 480ms for step changes, out-expo easing (`cubic-bezier(0.16, 1, 0.3, 1)`).

### Don't:
- **Don't** use glass panels away from landscape art; the nav pill is the only exception.
- **Don't** add eyebrow or kicker labels above headings.
- **Don't** use hard offset shadows; shadows are soft and ink-tinted.
- **Don't** inset or round a full-bleed band.
- **Don't** write one-off sizes for the hero headline, section headings or featured amounts; use the role tokens.
- **Don't** use cream or warm paper as a UI ground; warmth lives only in the art's horizon glow.
- **Don't** fill the open sky in the hero with badges, metrics or logos.
- **Don't** set the display serif in bold or below headline size.
- **Don't** use art colors from `src/constants/art.ts` in UI components.
