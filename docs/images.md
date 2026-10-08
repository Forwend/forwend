# Images

Every raster in `apps/web/public/images/` needs one row here; `node scripts/check-images.mjs`
(check `images-check`) fails otherwise. Mood images (landscapes, textures) come from the Grok CLI
(`grok -p`, `imagine` skill). Product UI, charts, numbers and text are always built in code.

Status 2026-10-08: no raster images yet. Grok `image_gen` returned HTTP 403 (no credits), so F002
is blocked. The hero, checkout, call-to-action and footer use code-drawn SVG art from
`apps/web/src/components/art/` in the same slots. When credits exist, F002 generates the images
below and adds a row for each file.

Style suffix for every prompt: painterly digital illustration, soft morning light, gentle haze,
muted greens and sky blues, wide cinematic composition, no text, no people in focus.

Planned slots: hero (desktop 16:9 and a mobile crop), checkout band (dusk), call-to-action texture
(halftone), footer ridges, Open Graph image (1200x630).

| Slot | File | Prompt | Date |
|---|---|---|---|
