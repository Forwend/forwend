import { createHmac } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { mockInvoice, NOW, OPEN, PAY } from "./pay-invoice";
import { API_URL, EXAMPLE_URL, EXAMPLE_WEBHOOK_SECRET, PUBLIC_URL } from "./servers";

// R-170: the example merchant (apps/example-merchant) with Forwend's real checkout frame and the stub api.

type Session = {
  sessionId: string;
  body: { amountUsd: string; reference: string; items: object[] };
  paid: boolean;
};
const sessions = async (page: Page): Promise<Session[]> =>
  (await page.request.get(`${API_URL}/__test/sessions`)).json();

// A delivery as Forwend sends it, signed per Standard Webhooks with the example's endpoint secret.
async function deliver(page: Page, type: string, invoiceId: string, sequence: number) {
  const id = `msg_${type}_${sequence}`;
  const data = JSON.stringify({
    id: `evt_${sequence}`,
    type,
    livemode: false,
    sequence,
    timestamp: new Date().toISOString(),
    data: { invoice: { invoiceId }, held: null },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(EXAMPLE_WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${data}`).digest("base64");
  return page.request.post(`${EXAMPLE_URL}/api/webhooks/forwend`, {
    data,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  });
}

async function order(page: Page) {
  // Forwend's frame reads the pay page fixture; the stub hands every checkout its token.
  await page.clock.install({ time: NOW });
  await mockInvoice(page, OPEN);
  await page.goto(EXAMPLE_URL);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByRole("spinbutton").nth(1).fill("1");
  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const orderId = page.url().split("/").at(-1) ?? "";
  const session = (await sessions(page)).find((s) => s.body.reference === orderId);
  if (!session) throw new Error(`no checkout for order ${orderId}`);
  return { orderId, session };
}

test.describe("example merchant", () => {
  test("prices the cart on its server and shows Forwend's pay panel it can't read, under its Content-Security-Policy", async ({
    page,
  }) => {
    const { session } = await order(page);
    // 2 × 24.00 + 1 × 12.50, from the shop's catalog, whatever the browser showed.
    expect(session.body.amountUsd).toBe("60.50");
    expect(session.body.items).toEqual([
      { description: "Espresso beans, 1 kg", quantity: "2", unitPrice: "24.00" },
      { description: "Stoneware mug", quantity: "1", unitPrice: "12.50" },
    ]);
    const frame = page.frameLocator("iframe");
    await expect(frame.getByText("Alice Design GmbH", { exact: true })).toBeVisible();
    await expect(frame.getByRole("button", { name: "Show address" })).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelector("iframe")?.contentDocument ?? null),
    ).toBeNull();
    const policy = (await page.request.get(page.url())).headers()["content-security-policy"];
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`frame-src ${PUBLIC_URL}`);

    await page.getByRole("button", { name: "Full checkout" }).click();
    await expect(page.frameLocator("iframe").getByText("Logo design")).toBeVisible();
    await page.getByRole("button", { name: "Pay on Forwend" }).click();
    await expect(
      page.getByRole("link", { name: "Pay with stablecoins on Forwend" }),
    ).toHaveAttribute("href", `${PUBLIC_URL}/pay/${PAY}`);
  });

  test("ships an order only from a verified webhook the API confirms, and only once", async ({
    page,
  }) => {
    const { orderId, session } = await order(page);
    const waiting = page.getByText("Waiting for payment.");
    const paid = page.getByText("Paid. Your order is on its way.");
    const shipped = async () =>
      (await (await page.request.get(`${EXAMPLE_URL}/api/orders/${orderId}`)).json()).fulfilledAt;

    // A message the page forges, as if from the frame, changes nothing.
    await page.evaluate((invoiceId) => {
      window.postMessage(
        { source: "forwend", v: 1, type: "status", invoiceId, paymentStatus: "paid" },
        "*",
      );
    }, session.sessionId);
    // A signed event while the API still says unpaid ships nothing either.
    expect((await deliver(page, "invoice.paid", session.sessionId, 2)).status()).toBe(200);
    await page.clock.runFor(4000);
    await expect(waiting).toBeVisible();
    expect(await shipped()).toBeNull();

    await page.request.post(`${API_URL}/__test/sessions/${session.sessionId}/paid`);
    expect((await deliver(page, "invoice.paid", session.sessionId, 2)).status()).toBe(200);
    await page.clock.runFor(4000);
    await expect(paid).toBeVisible();
    const first = await shipped();
    expect(first).not.toBeNull();

    // The same delivery again, and a later event, ship nothing more.
    expect((await deliver(page, "invoice.paid", session.sessionId, 2)).status()).toBe(200);
    expect((await deliver(page, "invoice.settled", session.sessionId, 3)).status()).toBe(200);
    expect(await shipped()).toBe(first);
  });

  test("refuses a webhook it can't verify", async ({ page }) => {
    const answer = await page.request.post(`${EXAMPLE_URL}/api/webhooks/forwend`, {
      data: JSON.stringify({
        type: "invoice.paid",
        data: { invoice: { invoiceId: `0x${"ab".repeat(32)}` } },
      }),
      headers: {
        "Content-Type": "application/json",
        "webhook-id": "msg_x",
        "webhook-timestamp": "1",
      },
    });
    expect(answer.status()).toBe(400);
  });
});
