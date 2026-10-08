# Images

Every raster in `apps/web/public/images/` needs one row here; `node scripts/check-images.mjs`
(check `images-check`) fails otherwise. Mood images (landscapes, textures) come from the Codex CLI built-in
`image_gen` tool, run headless with `codex exec` (D-9). Product UI, charts, numbers and text are always built in code.

Status 2026-10-08: Grok `image_gen` returned HTTP 403 (no credits), so the owner switched to Codex.
F002 generated the three direction candidates below. Since F011 the landing hero and checkout
section use the A and B images; the call to action and footer keep code-drawn art. Files are WebP (cwebp -q 82); the
original PNGs stay in `$CODEX_HOME/generated_images/`.

Style suffix for every prompt: painterly digital illustration, soft morning light, gentle haze,
muted greens and sky blues, wide cinematic composition, no text, no people in focus.

Planned slots: hero (desktop 16:9 and a mobile crop), checkout band (dusk), call-to-action texture
(halftone), footer ridges, Open Graph image (1200x630).

| Slot | File | Prompt | Date |
|---|---|---|---|
| Landing hero background; direction A candidate (1672x941) | `images/hero-dawn.webp` | Wide valley at sunrise seen from a low hill. A calm river starts at the bottom center of the frame and winds gently up to a bright horizon in the exact center. Pine forests on the left and right edges, layered blue-grey mountains in the distance, soft morning haze. The upper 45 percent of the image is open pale sky with no objects, reserved for a headline. Painterly digital illustration, soft morning light, gentle haze, muted greens and cool sky blues, no cream or warm beige tones, wide cinematic composition, no text, no people, no buildings, no logos. | 2026-10-08 |
| Landing checkout section background; direction B candidate (1916x821) | `images/checkout-dusk.webp` | Mountain ridges at dusk seen from a high viewpoint. Layered ridgelines fade from deep violet in the foreground to warm amber near a low setting sun on the right third of the horizon. The lower 40 percent of the image falls into near-black shadow (#0d0c11 tone) so light text and dark product panels can sit on it. The upper sky is a calm gradient from dark indigo to soft peach with no objects. Painterly digital illustration, quiet and cinematic, fine atmospheric haze, no text, no people, no buildings, no logos. | 2026-10-08 |
| Hero candidate, direction C Halftone Horizon (2043x770) | `images/candidates/hero-c-halftone-horizon.webp` | A mountain ridge that rises from left to right like a gently climbing line chart, rendered entirely in a halftone dot pattern: cobalt blue dots on a cool off-white (#f1f4fa) ground, dots large and dense at the bottom, shrinking to tiny points at the ridge edge. Clean editorial print style, like a risograph halftone. The upper half is empty off-white space for a headline. No other colors, no text, no numbers, no axes, no grid lines, no logos. | 2026-10-08 |
| Landing hero background, dark theme (1672x941); edit of `images/hero-dawn.webp` with the same composition | `images/hero-night.webp` | Codex image_gen edit mode with hero-dawn as the source: Keep the exact same composition, camera, river course, mountains, pine trees, hills and rocks in the same positions and sizes. Change the time of day to a calm night a while after sunset: deep blue-green night sky with a few faint stars in the upper area, a soft moonlit glow near the horizon where the sun was, the river reflecting cool moonlight, landscape in dark muted blue-green tones, gentle low mist in the valley. The upper 45 percent stays open dark sky with no objects, for light headline text. Painterly digital illustration matching the original style. No text, no people, no buildings, no logos. | 2026-10-08 |
