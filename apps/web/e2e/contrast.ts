import type { Locator, Page } from "@playwright/test";

const luminance = ([r, g, b]: number[]) => {
  const c = [r ?? 0, g ?? 0, b ?? 0].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};

/**
 * Contrast of a text element against the pixels actually behind it: the text is made transparent,
 * its box is captured, and the 5th-percentile worst pixel is used (a few stray pixels, such as the
 * sun's core, do not decide the result).
 */
export async function textContrast(page: Page, text: Locator): Promise<number> {
  const color = await text.evaluate((el) => getComputedStyle(el).color);
  const rgb = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  await text.evaluate((el) => {
    (el as HTMLElement).style.color = "transparent";
  });
  const png = await text.screenshot({ animations: "disabled" });
  await text.evaluate((el) => {
    (el as HTMLElement).style.color = "";
  });
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const out: number[][] = [];
    for (let i = 0; i < data.length; i += 16)
      out.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
    return out;
  }, png.toString("base64"));
  const textL = luminance(rgb);
  const ratios = pixels
    .map((p) => {
      const bgL = luminance(p);
      return (Math.max(textL, bgL) + 0.05) / (Math.min(textL, bgL) + 0.05);
    })
    .sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.05)] ?? 0;
}
