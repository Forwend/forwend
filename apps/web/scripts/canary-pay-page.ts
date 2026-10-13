// The canary's browser (R-51): `node canary-pay-page.ts <web origin>` reads ids from stdin (an invoice id, or
// `<id>?option=<option id>` for one option of a payer-chooses invoice), opens each /pay/<id> as a payer would, passes the network-confirm gate, picks each way to pay in turn and prints one JSON line
// per id with the amount panel's text, every address the send step shows and whether each QR code encodes the address
// shown, or why none is shown. It reads only the DOM and imports nothing from src/: the canary must not share the page's code. Keep uqr at
// the version ui-web uses.
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
  const method = page.locator('section[aria-labelledby="pay-method"]');
  const choices = method.locator("[data-method]");
  await choices.first().waitFor();
  const send = page.locator('section[aria-labelledby="pay-send"]');
  const addresses = new Set<string>();
  let qrMatches = true;
  const count = await choices.count();
  for (let i = 0; i < count; i++) {
    // A chosen way folds into its step; Change opens the choices again.
    if (i > 0) await method.locator("[data-change]").click();
    await choices.nth(i).click();
    await send.locator("svg[role=img]").first().waitFor();
    const shown = Array.from((await send.innerText()).matchAll(ADDRESS), ([address]) => address);
    for (const address of shown) addresses.add(address.toLowerCase());
    const codes = await send.locator("svg[role=img] path").all();
    if (!codes.length) qrMatches = false;
    for (const code of codes) {
      const path = (await code.getAttribute("d")) ?? "";
      if (!shown.some((address) => encodes(path, address))) qrMatches = false;
    }
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
