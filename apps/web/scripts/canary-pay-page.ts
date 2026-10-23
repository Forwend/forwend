// R-51: `node canary-pay-page.ts <web origin>` reads pay ids from stdin and prints one JSON line per id.
// Reads only the DOM, never src/: the canary must not share the page's code. Keep uqr at ui-web's version.
import { text } from "node:stream/consumers";
import { chromium, type Page } from "@playwright/test";
import { encode } from "uqr";

// The lookahead keeps a transaction hash from matching as an address.
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

export type PayPage = {
  id: string;
  addresses?: string[];
  qrMatches?: boolean;
  amountText?: string;
  error?: string;
};

const drawnCells = (path: string) =>
  new Set(Array.from(path.matchAll(/M(\d+) (\d+)/g), ([, x, y]) => `${x} ${y}`));

// packages/ui-web's QrCode draws encode(address, { border: 4 }), the address exactly as the page shows it.
function encodes(path: string, address: string) {
  const drawn = drawnCells(path);
  const want = encode(address, { border: 4 }).data.flatMap((row, y) =>
    row.flatMap((on, x) => (on ? [`${x} ${y}`] : [])),
  );
  return drawn.size === want.length && want.every((cell) => drawn.has(cell));
}

export async function readPayPage(page: Page, web: string, id: string): Promise<PayPage> {
  // The canary is no payer: its loads must not count as views of the pay link (R-125).
  await page.route("**/v1/invoices/*/views", (route) => route.abort());
  await page.goto(`${web}/pay/${id}`);
  // Scoped to main: Next's route announcer is also role=alert.
  const alert = page.locator("main [role=alert]");
  await page.locator("#pay-amount").or(alert).first().waitFor();
  if (await alert.count()) return { id, error: `page alert: ${await alert.first().innerText()}` };
  const gate = page.locator('section[aria-labelledby="pay-before"]');
  if (!(await gate.count()))
    return { id, error: "no address shown: the invoice is not open for payment" };
  const amountText = await page.locator('section[aria-labelledby="pay-amount"]').innerText();
  await gate.getByRole("button").click();
  const send = page.locator('section[aria-labelledby="pay-send"]');
  await send.locator("svg[role=img]").first().waitFor();
  const shown = Array.from((await send.innerText()).matchAll(ADDRESS), ([address]) => address);
  const addresses = new Set(shown.map((address) => address.toLowerCase()));
  const codes = await send.locator("svg[role=img] path").all();
  let qrMatches = codes.length > 0;
  for (const code of codes) {
    const path = (await code.getAttribute("d")) ?? "";
    if (!shown.some((address) => encodes(path, address))) qrMatches = false;
  }
  return { id, addresses: [...addresses], qrMatches, amountText };
}

if (import.meta.main) {
  const ids = (await text(process.stdin)).split(/\s+/).filter(Boolean);
  const browser = await chromium.launch();
  try {
    for (const id of ids) {
      const page = await browser.newPage();
      const result = await readPayPage(page, process.argv[2] ?? "", id).catch(
        (error: Error): PayPage => ({ id, error: error.message.split("\n")[0] }),
      );
      console.log(JSON.stringify(result));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
