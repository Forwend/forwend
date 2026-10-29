# Images

Every raster in `apps/web/public/images/` needs one row here; `node scripts/check-images.mjs`
(check `images-check`) fails otherwise. Mood images (landscapes, textures) come from the Codex CLI built-in
`image_gen` tool, run headless with `codex exec` (D-9). Product UI, charts, numbers and text are always built in code.

Files are WebP (cwebp -q 82); the original PNGs stay in `$CODEX_HOME/generated_images/`.

Signal (D-113) uses one abstract grain landscape; the older rows below are the Dawn Path images, kept for
`/kit/directions`. Their style suffix was: painterly digital illustration, soft morning light, gentle haze,
muted greens and sky blues, wide cinematic composition, no text, no people in focus.

| Slot | File | Prompt | Date |
|---|---|---|---|
| Signal hero, sign-in band, personal balance card and 404 (1920x1280, from a 1536x1024 original); one file for both themes, muted by CSS filters in dark mode (D-113) | `images/hero-signal.webp` | Abstract landscape of soft rolling dunes made of light, in a smooth gradient from chartreuse lime through mint to deep teal and near-black at the bottom, covered in fine film grain and stipple noise like a risograph print. Minimal, calm, modern, wide composition, the top 40 percent pale mint sky fading to white. No text, no objects, no people, no logos, no border. | 2026-10-25 |
| Landing hero background; direction A candidate (1672x941) | `images/hero-dawn.webp` | Wide valley at sunrise seen from a low hill. A calm river starts at the bottom center of the frame and winds gently up to a bright horizon in the exact center. Pine forests on the left and right edges, layered blue-grey mountains in the distance, soft morning haze. The upper 45 percent of the image is open pale sky with no objects, reserved for a headline. Painterly digital illustration, soft morning light, gentle haze, muted greens and cool sky blues, no cream or warm beige tones, wide cinematic composition, no text, no people, no buildings, no logos. | 2026-10-08 |
| Landing checkout section background; direction B candidate (1916x821) | `images/checkout-dusk.webp` | Mountain ridges at dusk seen from a high viewpoint. Layered ridgelines fade from deep violet in the foreground to warm amber near a low setting sun on the right third of the horizon. The lower 40 percent of the image falls into near-black shadow (#0d0c11 tone) so light text and dark product panels can sit on it. The upper sky is a calm gradient from dark indigo to soft peach with no objects. Painterly digital illustration, quiet and cinematic, fine atmospheric haze, no text, no people, no buildings, no logos. | 2026-10-08 |
| Hero candidate, direction C Halftone Horizon (2043x770) | `images/candidates/hero-c-halftone-horizon.webp` | A mountain ridge that rises from left to right like a gently climbing line chart, rendered entirely in a halftone dot pattern: cobalt blue dots on a cool off-white (#f1f4fa) ground, dots large and dense at the bottom, shrinking to tiny points at the ridge edge. Clean editorial print style, like a risograph halftone. The upper half is empty off-white space for a headline. No other colors, no text, no numbers, no axes, no grid lines, no logos. | 2026-10-08 |
| Direction D Coastal Ledger (2172x724) | `images/candidates/d-coastal-ledger.webp` | Wide coastal cliffs at golden hour above a calm turquoise sea, a narrow footpath running along the cliff edge toward a distant lighthouse, soft sea mist, warm sand and seafoam tones, the upper half open pale sky with no objects. Painterly digital illustration, calm and confident, wide cinematic composition, no text, no people, no buildings except a tiny distant lighthouse, no logos. | 2026-10-08 |
| Direction E Paper Atlas (1942x809) | `images/candidates/e-paper-atlas.webp` | A topographic paper map seen from directly above: contour lines in deep ink green on a soft off-white paper, one route drawn in a single cobalt line winding from the lower left corner to a small circle in the upper right, faint grid, subtle paper texture, large empty paper area in the upper half. Editorial print style, flat, precise, no text, no numbers, no labels, no logos. | 2026-10-08 |
| Direction F Aurora Night (1916x821) | `images/candidates/f-aurora-night.webp` | A quiet northern night over a frozen lake surrounded by low pine hills, soft green and violet aurora ribbons across a deep navy sky, the lake reflecting the aurora, a thin path of footprints crossing the ice toward the horizon, the upper half mostly sky. Painterly digital illustration, calm, cinematic, no text, no people, no buildings, no logos. | 2026-10-08 |
| Direction G Terracotta Mesa (2172x724) | `images/candidates/g-terracotta-mesa.webp` | A wide desert mesa landscape at midday, layered terracotta and sand-colored rock formations, a single straight road running from the bottom center toward the horizon, clear pale sky in the upper half with no objects, crisp shadows. Warm but restrained palette, painterly digital illustration with clean shapes, no text, no people, no cars, no buildings, no logos. | 2026-10-08 |
| Direction H Glass Garden (2048x768) | `images/candidates/h-glass-garden.webp` | An abstract composition of soft frosted glass shapes and gentle gradients in mint, lilac and pale blue, floating panels and rounded forms catching soft light on a near-white background, one thin glowing line flowing through the shapes from left to right, the upper half calm and mostly empty. Clean modern 3D render look, soft shadows, no text, no numbers, no logos. | 2026-10-08 |

## Logo

Source: the owner's hand-drawn draft (2026-10-08). Steps used to make the files:

1. Codex `image_gen` edit mode on the draft: "Turn this rough draft into a clean, professional logo
   mark. Keep the same idea and silhouette ... perfectly mirror-symmetric ... pure flat white shape on
   a pure solid black square background, no tile, no text."
2. The left half was mirrored onto the right for exact symmetry, upscaled to 2048px and thresholded.
3. Traced to a vector with potrace (npm `potrace`, turdSize 40, optTolerance 0.25).
4. Files built from that one path with `sharp` and `png-to-ico`:
   - `packages/ui-web/src/icons/logo-data.ts`: the mark path (used by `Logo` and `LogoMark`)
   - `apps/web/public/brand/forwend-mark.svg`: one-color mark (currentColor)
   - `apps/web/public/brand/forwend-icon.svg` and `apps/web/src/app/icon.svg`: tile, `--fw-primary`
     with the mark in `--fw-on-primary`, mark at 62% of the tile
   - `apps/web/src/app/favicon.ico` (16, 32, 48), `apps/web/src/app/apple-icon.png` (180, square)
   - `apps/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark at 50% for the
     maskable safe zone)
